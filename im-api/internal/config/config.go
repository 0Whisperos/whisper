package config

import (
	"fmt"
	"github.com/0Whisperos/whisper/im-server/internal/service/auth"
	"gopkg.in/yaml.v3"
	"os"
	"time"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Redis    RedisConfig    `yaml:"redis"`
	Auth     AuthConfig     `yaml:"auth"`
	CORS     CORSConfig     `yaml:"cors"`
	Seed     SeedConfig     `yaml:"seed"`
}

func (config *Config) ValidateServer() error {
	if config.Server.ListenAddr == "" {
		return fmt.Errorf("server listen address is empty")
	} else if config.Database.DSN == "" {
		return fmt.Errorf("database DSN is empty")
	} else if config.Redis.Addr == "" {
		return fmt.Errorf("redis address is empty")
	} else if config.Auth.JWTSecret == "" {
		return fmt.Errorf("auth JWT secret is empty")
	} else if _, err := config.Auth.AccessTokenDuration(); err != nil {
		return err
	} else if _, err := config.Auth.RefreshTokenDuration(); err != nil {
		return err
	} else if len(config.CORS.AllowedOrigins) == 0 {
		return fmt.Errorf("cors allowed origins is empty")
	} else {
		for _, origin := range config.CORS.AllowedOrigins {
			if origin == "" {
				return fmt.Errorf("cors allowed origin is empty")
			}
		}
	}
	return nil
}

func (config *Config) ValidateSeed() error {
	return auth.ValidateAccount(config.Seed.Account, config.Seed.Password)
}

type ServerConfig struct {
	ListenAddr string `yaml:"listen_addr"`
}

type DatabaseConfig struct {
	DSN string `yaml:"dsn"`
}

type RedisConfig struct {
	Addr     string `yaml:"addr"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
}

type AuthConfig struct {
	JWTSecret       string `yaml:"jwt_secret"`
	AccessTokenTTL  string `yaml:"access_token_ttl"`
	RefreshTokenTTL string `yaml:"refresh_token_ttl"`
}

func (config AuthConfig) AccessTokenDuration() (time.Duration, error) {
	return parseRequiredDuration("auth access token TTL", config.AccessTokenTTL)
}

func (config AuthConfig) RefreshTokenDuration() (time.Duration, error) {
	return parseRequiredDuration("auth refresh token TTL", config.RefreshTokenTTL)
}

func parseRequiredDuration(name string, value string) (time.Duration, error) {
	if value == "" {
		return 0, fmt.Errorf("%s is empty", name)
	}
	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", name, err)
	}
	if duration <= 0 {
		return 0, fmt.Errorf("%s must be positive", name)
	}
	return duration, nil
}

type CORSConfig struct {
	AllowedOrigins []string `yaml:"allowed_origins"`
}

type SeedConfig struct {
	Account  string `yaml:"account"`
	Password string `yaml:"password"`
}

func Load(path string) (*Config, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config file:%q: %w", path, err)
	}
	var config Config
	if err := yaml.Unmarshal(contents, &config); err != nil {
		return nil, fmt.Errorf("parse config file:%q: %w", path, err)
	}
	return &config, nil
}

func LoadServerConfig(path string) (*Config, error) {
	cfg, err := Load(path)
	if err != nil {
		return nil, fmt.Errorf("load configuration: %w", err)
	}
	if err := cfg.ValidateServer(); err != nil {
		return nil, fmt.Errorf("validate server configuration: %w", err)
	}
	return cfg, nil
}
