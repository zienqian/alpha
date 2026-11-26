package router_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"cloud-agent-server/internal/config"
	"cloud-agent-server/internal/database"
	"cloud-agent-server/internal/handler"
	"cloud-agent-server/internal/model"
	"cloud-agent-server/internal/repository"
	"cloud-agent-server/internal/router"
	"cloud-agent-server/internal/service"
)

func setupTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	cfg := &config.Config{
		App: config.AppConfig{
			Name: "cloud-agent-server-test",
			Env:  "test",
		},
		Database: config.DatabaseConfig{
			Driver: "sqlite",
			DSN:    ":memory:",
		},
		CORS: config.CORSConfig{
			AllowOrigins: []string{"*"},
		},
	}

	db, err := database.New(cfg.Database, true)
	if err != nil {
		t.Fatalf("open sqlite memory db: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close(db)
	})

	if err := db.AutoMigrate(&model.Agent{}); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	repo := repository.NewAgentRepository(db)
	svc := service.NewAgentService(repo)

	return router.New(cfg, log, router.Handlers{
		Health: handler.NewHealthHandler(db, cfg.App.Name),
		Agent:  handler.NewAgentHandler(svc),
	})
}

func TestHealthEndpoints(t *testing.T) {
	engine := setupTestEngine(t)

	for _, path := range []string{"/healthz", "/readyz"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		engine.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s: expected 200, got %d (%s)", path, rec.Code, rec.Body.String())
		}
		if rec.Header().Get("X-Request-ID") == "" {
			t.Fatalf("GET %s: expected X-Request-ID header", path)
		}
	}
}

func TestAgentCRUDAndSSE(t *testing.T) {
	engine := setupTestEngine(t)

	// 1. Validation error on missing required fields
	badReq := httptest.NewRequest(http.MethodPost, "/api/v1/agents", strings.NewReader(`{"name":""}`))
	badReq.Header.Set("Content-Type", "application/json")
	badRec := httptest.NewRecorder()
	engine.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("POST invalid agent: expected 400, got %d", badRec.Code)
	}

	// 2. Create agent
	createBody := `{"name":"research-bot","description":"Cloud research agent","model":"gpt-5","system_prompt":"You are helpful."}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/agents", bytes.NewBufferString(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	engine.ServeHTTP(createRec, createReq)

	if createRec.Code != http.StatusCreated {
		t.Fatalf("POST /api/v1/agents: expected 201, got %d (%s)", createRec.Code, createRec.Body.String())
	}

	var createResp struct {
		Data model.Agent `json:"data"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}
	agentID := createResp.Data.ID
	if agentID == "" || createResp.Data.Status != model.AgentStatusIdle {
		t.Fatalf("unexpected created agent: %+v", createResp.Data)
	}

	// 3. List agents
	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/agents?limit=10&offset=0", nil)
	listRec := httptest.NewRecorder()
	engine.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET /api/v1/agents: expected 200, got %d", listRec.Code)
	}
	var listResp struct {
		Data service.ListAgentsResult `json:"data"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("unmarshal list response: %v", err)
	}
	if listResp.Data.Total != 1 || len(listResp.Data.Items) != 1 {
		t.Fatalf("expected 1 agent in list, got %+v", listResp.Data)
	}

	// 4. Update agent
	patchReq := httptest.NewRequest(http.MethodPatch, "/api/v1/agents/"+agentID, strings.NewReader(`{"status":"running"}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchRec := httptest.NewRecorder()
	engine.ServeHTTP(patchRec, patchReq)
	if patchRec.Code != http.StatusOK {
		t.Fatalf("PATCH /api/v1/agents/%s: expected 200, got %d (%s)", agentID, patchRec.Code, patchRec.Body.String())
	}
	var patchResp struct {
		Data model.Agent `json:"data"`
	}
	if err := json.Unmarshal(patchRec.Body.Bytes(), &patchResp); err != nil {
		t.Fatalf("unmarshal patch response: %v", err)
	}
	if patchResp.Data.Status != model.AgentStatusRunning {
		t.Fatalf("expected status running, got %q", patchResp.Data.Status)
	}

	// 5. SSE stream events
	sseReq := httptest.NewRequest(http.MethodGet, "/api/v1/agents/"+agentID+"/events", nil)
	sseRec := httptest.NewRecorder()
	engine.ServeHTTP(sseRec, sseReq)
	if sseRec.Code != http.StatusOK {
		t.Fatalf("GET events: expected 200, got %d", sseRec.Code)
	}
	if !strings.Contains(sseRec.Header().Get("Content-Type"), "text/event-stream") {
		t.Fatalf("expected text/event-stream content-type, got %q", sseRec.Header().Get("Content-Type"))
	}
	if !strings.Contains(sseRec.Body.String(), "agent.connected") || !strings.Contains(sseRec.Body.String(), "agent.ready") {
		t.Fatalf("unexpected SSE body: %s", sseRec.Body.String())
	}

	// 6. Delete agent
	delReq := httptest.NewRequest(http.MethodDelete, "/api/v1/agents/"+agentID, nil)
	delRec := httptest.NewRecorder()
	engine.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusNoContent {
		t.Fatalf("DELETE agent: expected 204, got %d", delRec.Code)
	}

	// 7. Get deleted agent returns 404
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/agents/"+agentID, nil)
	getRec := httptest.NewRecorder()
	engine.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusNotFound {
		t.Fatalf("GET deleted agent: expected 404, got %d", getRec.Code)
	}
}
