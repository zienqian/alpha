package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	App      AppConfig
	Server   ServerConfig
	Database DatabaseConfig
	Log      LogConfig
	CORS     CORSConfig
}

type AppConfig struct {
	Name string `env:"APP_NAME" envDefault:"cloud-agent-server"`
	Env  string `env:"APP_ENV"  envDefault:"development"`
}

func (a AppConfig) IsProduction() bool {
	return strings.EqualFold(a.Env, "production")
}

type ServerConfig struct {
	Host              string        `env:"SERVER_HOST"                envDefault:"0.0.0.0"`
	Port              int           `env:"SERVER_PORT"                envDefault:"8080"`
	ReadHeaderTimeout time.Duration `env:"SERVER_READ_HEADER_TIMEOUT" envDefault:"10s"`
	ReadTimeout       time.Duration `env:"SERVER_READ_TIMEOUT"        envDefault:"30s"`
	// WriteTimeout defaults to 0 so long-lived SSE agent streams are not prematurely terminated.
	WriteTimeout    time.Duration `env:"SERVER_WRITE_TIMEOUT"    envDefault:"0s"`
	IdleTimeout     time.Duration `env:"SERVER_IDLE_TIMEOUT"     envDefault:"60s"`
	ShutdownTimeout time.Duration `env:"SERVER_SHUTDOWN_TIMEOUT" envDefault:"10s"`
}

func (s ServerConfig) Addr() string {
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

type DatabaseConfig struct {
	Driver          string        `env:"DB_DRIVER"            envDefault:"sqlite"`
	DSN             string        `env:"DB_DSN"               envDefault:"data/cloud_agent.db"`
	MaxIdleConns    int           `env:"DB_MAX_IDLE_CONNS"    envDefault:"10"`
	MaxOpenConns    int           `env:"DB_MAX_OPEN_CONNS"    envDefault:"50"`
	ConnMaxLifetime time.Duration `env:"DB_CONN_MAX_LIFETIME" envDefault:"1h"`
	AutoMigrate     bool          `env:"DB_AUTO_MIGRATE"      envDefault:"true"`
}

type LogConfig struct {
	Level string `env:"LOG_LEVEL" envDefault:"info"`
}

type CORSConfig struct {
	AllowOrigins []string `env:"CORS_ALLOW_ORIGINS" envDefault:"*" envSeparator:","`
}

// Load reads an optional .env file and parses environment variables into Config.
func Load() (*Config, error) {
	if err := godotenv.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("load .env file: %w", err)
	}

	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return nil, fmt.Errorf("parse environment config: %w", err)
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func (c *Config) validate() error {
	switch strings.ToLower(c.Database.Driver) {
	case "sqlite", "postgres":
	default:
		return fmt.Errorf("unsupported DB_DRIVER %q (expected sqlite or postgres)", c.Database.Driver)
	}
	if c.Server.Port <= 0 || c.Server.Port > 65535 {
		return fmt.Errorf("invalid SERVER_PORT %d", c.Server.Port)
	}
	return nil
}
