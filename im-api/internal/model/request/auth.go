package request

type Login struct {
	Account  string `json:"account"`
	Password string `json:"password"`
}

type Refresh struct {
	RefreshToken string `json:"refresh_token"`
}

type Logout struct {
	RefreshToken string `json:"refresh_token"`
}
