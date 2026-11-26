package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"cloud-agent-server/internal/model"
)

var ErrNotFound = errors.New("record not found")

type AgentRepository interface {
	Create(ctx context.Context, agent *model.Agent) error
	GetByID(ctx context.Context, id string) (*model.Agent, error)
	List(ctx context.Context, limit, offset int) ([]model.Agent, int64, error)
	Update(ctx context.Context, agent *model.Agent) error
	Delete(ctx context.Context, id string) error
}

type gormAgentRepository struct {
	db *gorm.DB
}

func NewAgentRepository(db *gorm.DB) AgentRepository {
	return &gormAgentRepository{db: db}
}

func (r *gormAgentRepository) Create(ctx context.Context, agent *model.Agent) error {
	return r.db.WithContext(ctx).Create(agent).Error
}

func (r *gormAgentRepository) GetByID(ctx context.Context, id string) (*model.Agent, error) {
	var agent model.Agent
	err := r.db.WithContext(ctx).First(&agent, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &agent, nil
}

func (r *gormAgentRepository) List(ctx context.Context, limit, offset int) ([]model.Agent, int64, error) {
	var (
		agents []model.Agent
		total  int64
	)

	query := r.db.WithContext(ctx).Model(&model.Agent{})
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&agents).Error; err != nil {
		return nil, 0, err
	}

	return agents, total, nil
}

func (r *gormAgentRepository) Update(ctx context.Context, agent *model.Agent) error {
	return r.db.WithContext(ctx).Save(agent).Error
}

func (r *gormAgentRepository) Delete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&model.Agent{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
