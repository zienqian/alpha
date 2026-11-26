package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"cloud-agent-server/internal/model"
	"cloud-agent-server/internal/repository"
	"cloud-agent-server/internal/service"
)

type AgentHandler struct {
	svc service.AgentService
}

func NewAgentHandler(svc service.AgentService) *AgentHandler {
	return &AgentHandler{svc: svc}
}

type createAgentRequest struct {
	Name         string `json:"name" binding:"required,min=1,max=128"`
	Description  string `json:"description" binding:"max=2000"`
	Model        string `json:"model" binding:"required,min=1,max=128"`
	SystemPrompt string `json:"system_prompt"`
}

type updateAgentRequest struct {
	Name         *string            `json:"name" binding:"omitempty,min=1,max=128"`
	Description  *string            `json:"description" binding:"omitempty,max=2000"`
	Model        *string            `json:"model" binding:"omitempty,min=1,max=128"`
	SystemPrompt *string            `json:"system_prompt"`
	Status       *model.AgentStatus `json:"status" binding:"omitempty,oneof=idle running paused error"`
}

func (h *AgentHandler) Create(c *gin.Context) {
	var req createAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, http.StatusBadRequest, "INVALID_ARGUMENT", err.Error())
		return
	}

	agent, err := h.svc.Create(c.Request.Context(), service.CreateAgentInput{
		Name:         req.Name,
		Description:  req.Description,
		Model:        req.Model,
		SystemPrompt: req.SystemPrompt,
	})
	if err != nil {
		respondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create agent")
		return
	}

	respondCreated(c, agent)
}

func (h *AgentHandler) List(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	res, err := h.svc.List(c.Request.Context(), limit, offset)
	if err != nil {
		respondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list agents")
		return
	}

	respondOK(c, res)
}

func (h *AgentHandler) GetByID(c *gin.Context) {
	agent, err := h.svc.GetByID(c.Request.Context(), c.Param("id"))
	if errors.Is(err, repository.ErrNotFound) {
		respondError(c, http.StatusNotFound, "NOT_FOUND", "agent not found")
		return
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load agent")
		return
	}

	respondOK(c, agent)
}

func (h *AgentHandler) Update(c *gin.Context) {
	var req updateAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, http.StatusBadRequest, "INVALID_ARGUMENT", err.Error())
		return
	}

	agent, err := h.svc.Update(c.Request.Context(), c.Param("id"), service.UpdateAgentInput{
		Name:         req.Name,
		Description:  req.Description,
		Model:        req.Model,
		SystemPrompt: req.SystemPrompt,
		Status:       req.Status,
	})
	if errors.Is(err, repository.ErrNotFound) {
		respondError(c, http.StatusNotFound, "NOT_FOUND", "agent not found")
		return
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update agent")
		return
	}

	respondOK(c, agent)
}

func (h *AgentHandler) Delete(c *gin.Context) {
	err := h.svc.Delete(c.Request.Context(), c.Param("id"))
	if errors.Is(err, repository.ErrNotFound) {
		respondError(c, http.StatusNotFound, "NOT_FOUND", "agent not found")
		return
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to delete agent")
		return
	}

	c.Status(http.StatusNoContent)
}

// StreamEvents is a placeholder SSE endpoint demonstrating streaming responses for cloud agents.
func (h *AgentHandler) StreamEvents(c *gin.Context) {
	agent, err := h.svc.GetByID(c.Request.Context(), c.Param("id"))
	if errors.Is(err, repository.ErrNotFound) {
		respondError(c, http.StatusNotFound, "NOT_FOUND", "agent not found")
		return
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load agent")
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		respondError(c, http.StatusInternalServerError, "STREAMING_UNSUPPORTED", "streaming unsupported")
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	events := []gin.H{
		{"type": "agent.connected", "agent_id": agent.ID, "status": agent.Status, "timestamp": time.Now().UTC().Format(time.RFC3339)},
		{"type": "agent.ready", "agent_id": agent.ID, "model": agent.Model, "timestamp": time.Now().UTC().Format(time.RFC3339)},
	}

	for _, evt := range events {
		select {
		case <-c.Request.Context().Done():
			return
		default:
		}
		c.SSEvent("message", evt)
		flusher.Flush()
	}
}
