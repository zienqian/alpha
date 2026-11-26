package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"cloud-agent-server/internal/database"
)

type HealthHandler struct {
	db      *gorm.DB
	appName string
}

func NewHealthHandler(db *gorm.DB, appName string) *HealthHandler {
	return &HealthHandler{
		db:      db,
		appName: appName,
	}
}

// Liveness responds immediately to indicate the process is alive.
func (h *HealthHandler) Liveness(c *gin.Context) {
	respondOK(c, gin.H{
		"status":    "ok",
		"service":   h.appName,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// Readiness checks downstream dependencies (database) before accepting traffic.
func (h *HealthHandler) Readiness(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	if err := database.Ping(ctx, h.db); err != nil {
		respondError(c, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database is not ready")
		return
	}

	respondOK(c, gin.H{
		"status":    "ready",
		"service":   h.appName,
		"database":  "ok",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}
