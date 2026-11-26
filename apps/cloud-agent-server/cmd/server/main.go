package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"cloud-agent-server/internal/config"
	"cloud-agent-server/internal/database"
	"cloud-agent-server/internal/handler"
	"cloud-agent-server/internal/logger"
	"cloud-agent-server/internal/model"
	"cloud-agent-server/internal/repository"
	"cloud-agent-server/internal/router"
	"cloud-agent-server/internal/service"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", slog.Any("error", err))
		os.Exit(1)
	}

	log := logger.New(cfg.App.Env, cfg.Log.Level)
	log.Info("starting server",
		slog.String("app", cfg.App.Name),
		slog.String("env", cfg.App.Env),
		slog.String("db_driver", cfg.Database.Driver),
	)

	db, err := database.New(cfg.Database, cfg.App.IsProduction())
	if err != nil {
		log.Error("failed to connect database", slog.Any("error", err))
		os.Exit(1)
	}
	defer func() {
		if err := database.Close(db); err != nil {
			log.Error("failed to close database", slog.Any("error", err))
		}
	}()

	if cfg.Database.AutoMigrate {
		if err := db.AutoMigrate(&model.Agent{}); err != nil {
			log.Error("failed to run auto-migrate", slog.Any("error", err))
			os.Exit(1)
		}
	}

	// Dependency wiring
	agentRepo := repository.NewAgentRepository(db)
	agentSvc := service.NewAgentService(agentRepo)

	engine := router.New(cfg, log, router.Handlers{
		Health: handler.NewHealthHandler(db, cfg.App.Name),
		Agent:  handler.NewAgentHandler(agentSvc),
	})

	srv := &http.Server{
		Addr:              cfg.Server.Addr(),
		Handler:           engine,
		ReadHeaderTimeout: cfg.Server.ReadHeaderTimeout,
		ReadTimeout:       cfg.Server.ReadTimeout,
		WriteTimeout:      cfg.Server.WriteTimeout,
		IdleTimeout:       cfg.Server.IdleTimeout,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("http server listening", slog.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		log.Error("http server stopped unexpectedly", slog.Any("error", err))
		os.Exit(1)
	case sig := <-quit:
		log.Info("shutdown signal received", slog.String("signal", sig.String()))
	}

	ctx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Error("graceful shutdown failed", slog.Any("error", err))
		os.Exit(1)
	}

	log.Info("server stopped cleanly")
}
