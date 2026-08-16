package config

import (
	"fmt"
	"github.com/0Whisperos/whisper/im-server/internal/auth"
	"gopkg.in/yaml.v3"
	"os"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	CORS     CORSConfig     `yaml:"cors"`
	Seed     SeedConfig     `yaml:"seed"`
}

func (config *Config) ValidateServer() error {
	if config.Server.ListenAddr == "" {
		return fmt.Errorf("server listen address is empty")
	} else if config.Database.DSN == "" {
		return fmt.Errorf("database DSN is empty")
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
