package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AgentStatus string

const (
	AgentStatusIdle    AgentStatus = "idle"
	AgentStatusRunning AgentStatus = "running"
	AgentStatusPaused  AgentStatus = "paused"
	AgentStatusError   AgentStatus = "error"
)

// Agent represents a cloud agent definition stored in the database.
type Agent struct {
	ID           string         `gorm:"type:varchar(36);primaryKey" json:"id"`
	Name         string         `gorm:"type:varchar(128);not null;index" json:"name"`
	Description  string         `gorm:"type:text;default:''" json:"description"`
	Model        string         `gorm:"type:varchar(128);not null" json:"model"`
	SystemPrompt string         `gorm:"type:text;default:''" json:"system_prompt"`
	Status       AgentStatus    `gorm:"type:varchar(32);not null;default:'idle';index" json:"status"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
}

func (a *Agent) BeforeCreate(_ *gorm.DB) error {
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	if a.Status == "" {
		a.Status = AgentStatusIdle
	}
	return nil
}
