package authz

import "testing"

func TestAuthorizerAllowsOnlyConfiguredUserInPrivateChat(t *testing.T) {
	a := New(42)
	if !a.IsAllowedPrivateChat(42, 42) {
		t.Fatal("expected configured user in private chat to be allowed")
	}
	if a.IsAllowedPrivateChat(7, 7) {
		t.Fatal("expected other user to be rejected")
	}
	if a.IsAllowedPrivateChat(42, -100123) {
		t.Fatal("expected configured user in group/channel chat to be rejected")
	}
	if New(0).IsAllowedPrivateChat(42, 42) {
		t.Fatal("zero allowed user must not allow anyone")
	}
}
