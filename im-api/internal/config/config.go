package config

import (
	"fmt"
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
	} else if err := config.Database.Validate(); err != nil {
		return err
	} else if err := config.Redis.Validate(); err != nil {
		return err
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

type ServerConfig struct {
	ListenAddr string `yaml:"listen_addr"`
}

type DatabaseConfig struct {
	Host         string             `yaml:"host"`
	Port         int                `yaml:"port"`
	Username     string             `yaml:"username"`
	Password     string             `yaml:"password"`
	Name         string             `yaml:"name"`
	Charset      string             `yaml:"charset"`
	ParseTime    bool               `yaml:"parse_time"`
	Loc          string             `yaml:"loc"`
	Timeout      string             `yaml:"timeout"`
	ReadTimeout  string             `yaml:"read_timeout"`
	WriteTimeout string             `yaml:"write_timeout"`
	Pool         DatabasePoolConfig `yaml:"pool"`
}

type DatabasePoolConfig struct {
	MaxOpenConns    int    `yaml:"max_open_conns"`
	MaxIdleConns    int    `yaml:"max_idle_conns"`
	ConnMaxLifetime string `yaml:"conn_max_lifetime"`
	ConnMaxIdleTime string `yaml:"conn_max_idle_time"`
}

func (config DatabaseConfig) Validate() error {
	if config.Host == "" {
		return fmt.Errorf("database host is empty")
	}
	if config.Port <= 0 || config.Port > 65535 {
		return fmt.Errorf("database port is invalid")
	}
	if config.Username == "" {
		return fmt.Errorf("database username is empty")
	}
	if config.Name == "" {
		return fmt.Errorf("database name is empty")
	}
	if config.Charset == "" {
		return fmt.Errorf("database charset is empty")
	}
	if config.Loc == "" {
		return fmt.Errorf("database loc is empty")
	}
	if _, err := parseRequiredDuration("database timeout", config.Timeout); err != nil {
		return err
	}
	if _, err := parseRequiredDuration("database read timeout", config.ReadTimeout); err != nil {
		return err
	}
	if _, err := parseRequiredDuration("database write timeout", config.WriteTimeout); err != nil {
		return err
	}
	if config.Pool.MaxOpenConns < 0 {
		return fmt.Errorf("database pool max open conns must not be negative")
	}
	if config.Pool.MaxIdleConns < 0 {
		return fmt.Errorf("database pool max idle conns must not be negative")
	}
	if _, err := config.Pool.ConnMaxLifetimeDuration(); err != nil {
		return err
	}
	if _, err := config.Pool.ConnMaxIdleTimeDuration(); err != nil {
		return err
	}
	return nil
}

func (config DatabaseConfig) TimeoutDuration() (time.Duration, error) {
	return parseRequiredDuration("database timeout", config.Timeout)
}

func (config DatabaseConfig) ReadTimeoutDuration() (time.Duration, error) {
	return parseRequiredDuration("database read timeout", config.ReadTimeout)
}

func (config DatabaseConfig) WriteTimeoutDuration() (time.Duration, error) {
	return parseRequiredDuration("database write timeout", config.WriteTimeout)
}

func (config DatabasePoolConfig) ConnMaxLifetimeDuration() (time.Duration, error) {
	return parseOptionalDuration("database pool conn max lifetime", config.ConnMaxLifetime)
}

func (config DatabasePoolConfig) ConnMaxIdleTimeDuration() (time.Duration, error) {
	return parseOptionalDuration("database pool conn max idle time", config.ConnMaxIdleTime)
}

type RedisConfig struct {
	Host         string          `yaml:"host"`
	Port         int             `yaml:"port"`
	Username     string          `yaml:"username"`
	Password     string          `yaml:"password"`
	DB           int             `yaml:"db"`
	DialTimeout  string          `yaml:"dial_timeout"`
	ReadTimeout  string          `yaml:"read_timeout"`
	WriteTimeout string          `yaml:"write_timeout"`
	Pool         RedisPoolConfig `yaml:"pool"`
}

type RedisPoolConfig struct {
	PoolSize        int    `yaml:"pool_size"`
	MinIdleConns    int    `yaml:"min_idle_conns"`
	MaxIdleConns    int    `yaml:"max_idle_conns"`
	MaxActiveConns  int    `yaml:"max_active_conns"`
	PoolTimeout     string `yaml:"pool_timeout"`
	ConnMaxIdleTime string `yaml:"conn_max_idle_time"`
	ConnMaxLifetime string `yaml:"conn_max_lifetime"`
}

func (config RedisConfig) Validate() error {
	if config.Host == "" {
		return fmt.Errorf("redis host is empty")
	}
	if config.Port <= 0 || config.Port > 65535 {
		return fmt.Errorf("redis port is invalid")
	}
	if config.DB < 0 {
		return fmt.Errorf("redis db must not be negative")
	}
	if _, err := parseRequiredDuration("redis dial timeout", config.DialTimeout); err != nil {
		return err
	}
	if _, err := parseRequiredDuration("redis read timeout", config.ReadTimeout); err != nil {
		return err
	}
	if _, err := parseRequiredDuration("redis write timeout", config.WriteTimeout); err != nil {
		return err
	}
	if config.Pool.PoolSize < 0 {
		return fmt.Errorf("redis pool size must not be negative")
	}
	if config.Pool.MinIdleConns < 0 {
		return fmt.Errorf("redis pool min idle conns must not be negative")
	}
	if config.Pool.MaxIdleConns < 0 {
		return fmt.Errorf("redis pool max idle conns must not be negative")
	}
	if config.Pool.MaxActiveConns < 0 {
		return fmt.Errorf("redis pool max active conns must not be negative")
	}
	if _, err := config.Pool.PoolTimeoutDuration(); err != nil {
		return err
	}
	if _, err := config.Pool.ConnMaxIdleTimeDuration(); err != nil {
		return err
	}
	if _, err := config.Pool.ConnMaxLifetimeDuration(); err != nil {
		return err
	}
	return nil
}

func (config RedisConfig) DialTimeoutDuration() (time.Duration, error) {
	return parseRequiredDuration("redis dial timeout", config.DialTimeout)
}

func (config RedisConfig) ReadTimeoutDuration() (time.Duration, error) {
	return parseRequiredDuration("redis read timeout", config.ReadTimeout)
}

func (config RedisConfig) WriteTimeoutDuration() (time.Duration, error) {
	return parseRequiredDuration("redis write timeout", config.WriteTimeout)
}

func (config RedisPoolConfig) PoolTimeoutDuration() (time.Duration, error) {
	return parseRequiredDuration("redis pool timeout", config.PoolTimeout)
}

func (config RedisPoolConfig) ConnMaxIdleTimeDuration() (time.Duration, error) {
	return parseOptionalDuration("redis pool conn max idle time", config.ConnMaxIdleTime)
}

func (config RedisPoolConfig) ConnMaxLifetimeDuration() (time.Duration, error) {
	return parseOptionalDuration("redis pool conn max lifetime", config.ConnMaxLifetime)
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

func parseOptionalDuration(name string, value string) (time.Duration, error) {
	if value == "" {
		return 0, nil
	}
	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", name, err)
	}
	if duration < 0 {
		return 0, fmt.Errorf("%s must not be negative", name)
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
