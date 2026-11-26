import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  installSkill,
  listSkills,
  readSkillContent,
  SkillApiError,
  uninstallSkill,
  updateSkillSettings,
  type InstalledSkill,
  type SkillCatalog,
  type SkillSettingsUpdate,
} from "./api";

function applyOptimisticSettings(catalog: SkillCatalog, patch: SkillSettingsUpdate): SkillCatalog {
  const currentSettings = catalog.settings ?? {
    sharedDirectories: catalog.directories.some(d => d.kind === "shared" && d.enabled),
    claudeDirectories: catalog.directories.some(d => d.kind === "claude" && d.enabled),
    trustedProjects: [],
    disabledNames: catalog.skills.filter(s => s.disabledByName).map(s => s.name),
  };

  let disabledNames = [...currentSettings.disabledNames];
  const toggleSkill = patch.toggleSkill;
  if (toggleSkill) {
    if (toggleSkill.enabled) {
      disabledNames = disabledNames.filter(name => name !== toggleSkill.name);
    } else if (!disabledNames.includes(toggleSkill.name)) {
      disabledNames.push(toggleSkill.name);
    }
  }

  const sharedDirectories = patch.sharedDirectories ?? currentSettings.sharedDirectories;
  const claudeDirectories = patch.claudeDirectories ?? currentSettings.claudeDirectories;
  const projects = catalog.projects.map(project =>
    patch.trustProject && project.id === patch.trustProject.projectId
      ? { ...project, trusted: patch.trustProject.trusted }
      : project,
  );

  const directories = catalog.directories.map(directory => {
    const enabled = directory.kind === "shared"
      ? sharedDirectories
      : directory.kind === "claude"
        ? claudeDirectories
        : directory.enabled;
    const trusted = directory.source === "project" && patch.trustProject && patch.trustProject.projectId === catalog.projectId
      ? patch.trustProject.trusted
      : directory.trusted;
    return { ...directory, enabled, trusted };
  });

  const dirById = new Map(directories.map(d => [d.id, d]));
  const disabledSet = new Set(disabledNames);
  const seenActive = new Set<string>();
  const skills: InstalledSkill[] = catalog.skills.map(skill => {
    const directory = dirById.get(skill.directoryId);
    const dirEnabled = directory?.enabled ?? true;
    const dirTrusted = directory?.trusted ?? true;
    const disabledByName = disabledSet.has(skill.name);
    let status: InstalledSkill["status"];
    if (!dirEnabled || disabledByName) {
      status = "disabled";
    } else if (!dirTrusted) {
      status = "untrusted";
    } else if (skill.status === "reserved") {
      status = "reserved";
    } else if (seenActive.has(skill.name)) {
      status = "shadowed";
    } else {
      seenActive.add(skill.name);
      status = "available";
    }
    return { ...skill, status, disabledByName };
  });

  return {
    ...catalog,
    projects,
    directories,
    skills,
    settings: {
      ...currentSettings,
      sharedDirectories,
      claudeDirectories,
      disabledNames,
    },
  };
}

export function useSkillsCatalog(projectId: string | undefined) {
  const client = useQueryClient();
  const queryKey = ["skills", projectId] as const;

  const catalogQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => listSkills(projectId, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const installMutation = useMutation({
    mutationFn: installSkill,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["skills"] });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: updateSkillSettings,
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<SkillCatalog>(queryKey);
      if (previous) {
        client.setQueryData<SkillCatalog>(queryKey, applyOptimisticSettings(previous, patch));
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) client.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["skills"] });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: uninstallSkill,
    onMutate: async (target) => {
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<SkillCatalog>(queryKey);
      if (previous) {
        client.setQueryData<SkillCatalog>(queryKey, {
          ...previous,
          skills: previous.skills.filter(skill => !(skill.directoryId === target.directoryId && skill.name === target.name)),
        });
      }
      return { previous };
    },
    onError: (_error, _target, context) => {
      if (context?.previous) client.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["skills"] });
      void client.invalidateQueries({ queryKey: ["skill-content"] });
    },
  });

  return {
    catalogQuery,
    installMutation,
    settingsMutation,
    uninstallMutation,
  };
}

export function useSkillContent(input: { projectId?: string; directoryId: string; name: string } | undefined) {
  return useQuery({
    queryKey: ["skill-content", input?.projectId, input?.directoryId, input?.name],
    queryFn: ({ signal }) => {
      if (!input) throw new SkillApiError("SKILL_REQUEST_FAILED");
      return readSkillContent(input, signal);
    },
    enabled: Boolean(input),
    staleTime: 30_000,
    retry: false,
  });
}
