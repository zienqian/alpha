package router

import (
	"log/slog"

	"github.com/gin-gonic/gin"

	"cloud-agent-server/internal/config"
	"cloud-agent-server/internal/handler"
	"cloud-agent-server/internal/middleware"
)

type Handlers struct {
	Health *handler.HealthHandler
	Agent  *handler.AgentHandler
}

// New builds and configures the Gin HTTP engine with middlewares and routes.
func New(cfg *config.Config, log *slog.Logger, h Handlers) *gin.Engine {
	if cfg.App.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	_ = r.SetTrustedProxies(nil)

	r.Use(
		middleware.RequestID(),
		middleware.Logger(log),
		middleware.Recovery(log),
		middleware.CORS(cfg.CORS.AllowOrigins),
	)

	// Operational probes
	r.GET("/healthz", h.Health.Liveness)
	r.GET("/readyz", h.Health.Readiness)

	// API v1
	v1 := r.Group("/api/v1")
	{
		agents := v1.Group("/agents")
		{
			agents.POST("", h.Agent.Create)
			agents.GET("", h.Agent.List)
			agents.GET("/:id", h.Agent.GetByID)
			agents.PATCH("/:id", h.Agent.Update)
			agents.DELETE("/:id", h.Agent.Delete)
			agents.GET("/:id/events", h.Agent.StreamEvents)
		}
	}

	return r
}
