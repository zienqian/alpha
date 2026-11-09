import { useTranslation as useReactTranslation } from "react-i18next";
import { namespaces } from "./instance";

export function useTranslation() { return useReactTranslation(namespaces); }
