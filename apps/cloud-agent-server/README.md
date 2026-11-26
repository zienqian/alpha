# Cloud Agent Server (Go)

独立的云端 Agent Go 后端服务模板，位于 `apps/cloud-agent-server/`，使用独立 `go.mod` 管理依赖，与仓库内 Bun / Nx / TypeScript 工程完全解耦。

## 技术栈

| 模块 | 选型 | 说明 |
| --- | --- | --- |
| HTTP 框架 | **Gin** (`github.com/gin-gonic/gin`) | Go 生态最主流的 HTTP 框架，路由快、校验集成好、原生支持 SSE 流式输出 |
| ORM | **GORM** (`gorm.io/gorm`) | 开发效率高，支持 AutoMigrate、软删除、Hook，并通过 Repository 接口解耦便于后续扩展或替换 |
| 数据库驱动 | **PostgreSQL (`pgx/v5`)** + **纯 Go SQLite (`ncruces/go-sqlite3/gormlite`)** | 生产推荐 PostgreSQL；本地开发默认开箱即用纯 Go SQLite（无需 CGO / 无需起 Docker，跨平台兼容） |
| 配置管理 | **caarlos0/env** + **godotenv** | 强类型结构体映射环境变量，支持 `.env` 自动加载与启动校验 |
| 结构化日志 | 标准库 **`log/slog`** | 零外部依赖，开发环境输出易读文本，生产环境自动切换 JSON |
| 容器化 | 多阶段 **Dockerfile** (`distroless`) | 静态编译 (`CGO_ENABLED=0`)，极小镜像体积 |

## 目录结构

```text
apps/cloud-agent-server/
├── cmd/
│   └── server/
│       └── main.go              # 启动入口、依赖装配、优雅退出 (SIGINT/SIGTERM)
├── internal/
│   ├── config/                  # 强类型环境变量配置
│   ├── database/                # GORM 初始化、连接池、Ping/Close
│   ├── logger/                  # slog 结构化日志配置
│   ├── middleware/              # Request-ID、访问日志、Panic Recovery、CORS
│   ├── model/                   # 数据模型（示例：Agent）
│   ├── repository/              # 数据访问层（接口 + GORM 实现）
│   ├── service/                 # 业务逻辑层
│   ├── handler/                 # HTTP 控制器、统一响应结构、探针、SSE 示例
│   └── router/                  # 路由与中间件装配 + 集成测试
├── .env.example
├── .gitignore
├── Dockerfile
├── Makefile
├── go.mod
└── go.sum
```

## 快速开始

所有命令均在 `apps/cloud-agent-server` 目录内独立执行：

```bash
cd apps/cloud-agent-server

# 可选：复制环境变量模板（默认已可直接运行，使用本地 SQLite）
cp .env.example .env

# 启动服务（默认监听 :8080）
go run ./cmd/server
```

### 运行测试与构建

```bash
go test -v ./...
go vet ./...
CGO_ENABLED=0 go build -o bin/cloud-agent-server ./cmd/server
```

### 切换到 PostgreSQL

在 `.env` 或环境变量中修改驱动与 DSN 即可：

```env
DB_DRIVER=postgres
DB_DSN=host=localhost user=postgres password=postgres dbname=cloud_agent port=5432 sslmode=disable TimeZone=UTC
```

## 内置示例接口

- `GET /healthz`：存活探针（Liveness）
- `GET /readyz`：就绪探针（Readiness，校验数据库连接）
- `POST /api/v1/agents`：创建云端 Agent
- `GET /api/v1/agents?limit=20&offset=0`：分页查询 Agent
- `GET /api/v1/agents/:id`：获取单个 Agent
- `PATCH /api/v1/agents/:id`：更新 Agent 配置或状态
- `DELETE /api/v1/agents/:id`：软删除 Agent
- `GET /api/v1/agents/:id/events`：SSE 事件流占位示例（已配置 `SERVER_WRITE_TIMEOUT=0s` 适配长连接）

示例请求：

```bash
curl -X POST http://localhost:8080/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{"name":"cloud-coder","model":"gpt-5","description":"Cloud coding agent"}'
```
