package auth

import "testing"

func TestValidateCredentialsAcceptsAccountLengthBoundaries(t *testing.T) {
	// 测试目标：验证 8 位和 12 位纯数字账号以及非空密码可以通过 auth 凭据校验。
	// 构造方法：直接调用 ValidateCredentials，分别传入最短和最长合法账号。
	// 输入数据：account=00123456、001234567890，password=secret。
	// 预期行为：两个边界账号均不返回错误。
	for _, account := range []string{"00123456", "001234567890"} {
		if err := ValidateCredentials(account, "secret"); err != nil {
			t.Fatalf("ValidateCredentials(%q) returned an error: %v", account, err)
		}
	}
}

func TestValidateCredentialsRejectsInvalidAccountsAndEmptyPassword(t *testing.T) {
	// 测试目标：验证账号长度、账号字符和空密码的非法输入会被拒绝。
	// 构造方法：直接调用 ValidateCredentials，分别构造短账号、长账号、非数字账号和空密码。
	// 输入数据：account=0123456、0012345678901、abcdefgh、00123456 且 password 为空。
	// 预期行为：每个非法场景都返回非空错误。
	testCases := []struct {
		name     string
		account  string
		password string
	}{
		{name: "short account", account: "0123456", password: "secret"},
		{name: "long account", account: "0012345678901", password: "secret"},
		{name: "letters account", account: "abcdefgh", password: "secret"},
		{name: "empty password", account: "00123456", password: ""},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			// 测试目标：验证当前非法凭据组合会被 ValidateCredentials 拒绝。
			// 构造方法：使用表格中的 account/password 调用校验函数。
			// 输入数据：当前子测试的 account 和 password。
			// 预期行为：返回非空错误。
			if err := ValidateCredentials(testCase.account, testCase.password); err == nil {
				t.Fatal("ValidateCredentials returned nil error")
			}
		})
	}
}

func TestValidateRegistrationAcceptsUnicodeNicknameAndNonEmptyPassword(t *testing.T) {
	// 测试目标：验证注册校验按 Unicode 字符数接受合法昵称，并接受包含首尾空白的原始昵称在规范化后注册。
	// 构造方法：直接调用注册校验函数，传入一个包含中文字符的昵称和非空密码。
	// 输入数据：nickname=张三，password=secret。
	// 预期行为：校验不返回错误。
	if err := ValidateRegistration("张三", "secret"); err != nil {
		t.Fatalf("ValidateRegistration returned an error: %v", err)
	}
}

func TestValidateRegistrationRejectsNicknameAndPasswordBoundaries(t *testing.T) {
	// 测试目标：验证空昵称、超过 15 个 Unicode 字符的昵称和空密码都会被注册校验拒绝。
	// 构造方法：使用独立子测试分别传入非法昵称或密码，避免不同边界场景互相影响。
	// 输入数据：nickname 为空、16 个中文字符，或 nickname=张三 且 password 为空。
	// 预期行为：每个场景都返回非空错误。
	testCases := []struct {
		name     string
		nickname string
		password string
	}{
		{name: "empty nickname", nickname: "", password: "secret"},
		{name: "sixteen unicode characters", nickname: "一二三四五六七八九十一二三四五六", password: "secret"},
		{name: "empty password", nickname: "张三", password: ""},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			// 测试目标：验证当前具体非法注册输入会被拒绝。
			// 构造方法：使用子测试中的 nickname/password 调用 ValidateRegistration。
			// 输入数据：当前子测试定义的昵称和密码。
			// 预期行为：函数返回非空错误。
			if err := ValidateRegistration(testCase.nickname, testCase.password); err == nil {
				t.Fatal("ValidateRegistration returned nil error")
			}
		})
	}
}
