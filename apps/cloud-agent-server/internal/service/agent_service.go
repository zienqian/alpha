package service

import (
	"context"
	"strings"

	"cloud-agent-server/internal/model"
	"cloud-agent-server/internal/repository"
)

type CreateAgentInput struct {
	Name         string
	Description  string
	Model        string
	SystemPrompt string
}

type UpdateAgentInput struct {
	Name         *string
	Description  *string
	Model        *string
	SystemPrompt *string
	Status       *model.AgentStatus
}

type ListAgentsResult struct {
	Items  []model.Agent `json:"items"`
	Total  int64         `json:"total"`
	Limit  int           `json:"limit"`
	Offset int           `json:"offset"`
}

type AgentService interface {
	Create(ctx context.Context, input CreateAgentInput) (*model.Agent, error)
	GetByID(ctx context.Context, id string) (*model.Agent, error)
	List(ctx context.Context, limit, offset int) (*ListAgentsResult, error)
	Update(ctx context.Context, id string, input UpdateAgentInput) (*model.Agent, error)
	Delete(ctx context.Context, id string) error
}

type agentService struct {
	repo repository.AgentRepository
}

func NewAgentService(repo repository.AgentRepository) AgentService {
	return &agentService{repo: repo}
}

func (s *agentService) Create(ctx context.Context, input CreateAgentInput) (*model.Agent, error) {
	agent := &model.Agent{
		Name:         strings.TrimSpace(input.Name),
		Description:  strings.TrimSpace(input.Description),
		Model:        strings.TrimSpace(input.Model),
		SystemPrompt: input.SystemPrompt,
		Status:       model.AgentStatusIdle,
	}
	if err := s.repo.Create(ctx, agent); err != nil {
		return nil, err
	}
	return agent, nil
}

func (s *agentService) GetByID(ctx context.Context, id string) (*model.Agent, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *agentService) List(ctx context.Context, limit, offset int) (*ListAgentsResult, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	items, total, err := s.repo.List(ctx, limit, offset)
	if err != nil {
		return nil, err
	}

	return &ListAgentsResult{
		Items:  items,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}, nil
}

func (s *agentService) Update(ctx context.Context, id string, input UpdateAgentInput) (*model.Agent, error) {
	agent, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if input.Name != nil {
		agent.Name = strings.TrimSpace(*input.Name)
	}
	if input.Description != nil {
		agent.Description = strings.TrimSpace(*input.Description)
	}
	if input.Model != nil {
		agent.Model = strings.TrimSpace(*input.Model)
	}
	if input.SystemPrompt != nil {
		agent.SystemPrompt = *input.SystemPrompt
	}
	if input.Status != nil {
		agent.Status = *input.Status
	}

	if err := s.repo.Update(ctx, agent); err != nil {
		return nil, err
	}
	return agent, nil
}

func (s *agentService) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}
