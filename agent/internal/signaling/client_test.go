package signaling

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// fakeServer minimally mimics the real signaling protocol for client tests.
// It records every message it receives and lets a test push a reply.
type fakeServer struct {
	t        *testing.T
	upgrader websocket.Upgrader
	mu       sync.Mutex
	received []Message
	reply    func(*websocket.Conn, Message)
}

func newFakeServer(t *testing.T, reply func(*websocket.Conn, Message)) *httptest.Server {
	t.Helper()
	fs := &fakeServer{t: t, reply: reply}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := fs.upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		defer conn.Close()
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var msg Message
			if err := json.Unmarshal(data, &msg); err != nil {
				t.Errorf("unmarshal: %v", err)
				return
			}
			fs.mu.Lock()
			fs.received = append(fs.received, msg)
			fs.mu.Unlock()
			if fs.reply != nil {
				fs.reply(conn, msg)
			}
		}
	}))
}

func wsURL(httpURL string) string {
	return "ws" + strings.TrimPrefix(httpURL, "http") + "/ws"
}

func TestDialAndRegisterReceivesRegisteredAck(t *testing.T) {
	srv := newFakeServer(t, func(conn *websocket.Conn, msg Message) {
		if msg.Type == "register" {
			_ = conn.WriteJSON(Message{Type: "registered", Code: msg.Code})
		}
	})
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	conn, err := Dial(ctx, wsURL(srv.URL))
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	if err := conn.SendRegister("123456", "host", "full"); err != nil {
		t.Fatalf("SendRegister: %v", err)
	}
	msg, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if msg.Type != "registered" {
		t.Fatalf("got %q, want registered", msg.Type)
	}
	if msg.Code != "123456" {
		t.Fatalf("got code %q, want 123456", msg.Code)
	}
}

func TestRegisterSendsCorrectShape(t *testing.T) {
	got := make(chan Message, 1)
	srv := newFakeServer(t, func(conn *websocket.Conn, msg Message) {
		got <- msg
		_ = conn.WriteJSON(Message{Type: "registered", Code: msg.Code})
	})
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	conn, err := Dial(ctx, wsURL(srv.URL))
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	if err := conn.SendRegister("987654", "my-host", "full"); err != nil {
		t.Fatalf("SendRegister: %v", err)
	}

	select {
	case msg := <-got:
		if msg.Type != "register" {
			t.Errorf("Type = %q, want register", msg.Type)
		}
		if msg.Role != "agent" {
			t.Errorf("Role = %q, want agent", msg.Role)
		}
		if msg.Code != "987654" {
			t.Errorf("Code = %q, want 987654", msg.Code)
		}
		if msg.Hostname != "my-host" {
			t.Errorf("Hostname = %q, want my-host", msg.Hostname)
		}
	case <-time.After(time.Second):
		t.Fatal("server never received the register message")
	}
}

func TestDialFailsOnBadURL(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_, err := Dial(ctx, "ws://127.0.0.1:1/ws")
	if err == nil {
		t.Fatalf("expected error dialling unreachable port")
	}
}

func TestReadReturnsErrorWhenServerCloses(t *testing.T) {
	srv := newFakeServer(t, func(conn *websocket.Conn, msg Message) {
		_ = conn.Close()
	})
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	conn, err := Dial(ctx, wsURL(srv.URL))
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	if err := conn.SendRegister("123456", "h", "full"); err != nil {
		t.Fatalf("SendRegister: %v", err)
	}
	if _, err := conn.Read(ctx); err == nil {
		t.Fatalf("expected Read to error after server close")
	}
}

func TestServerErrorMessageDecodesReason(t *testing.T) {
	srv := newFakeServer(t, func(conn *websocket.Conn, msg Message) {
		_ = conn.WriteJSON(Message{Type: "error", Reason: "duplicate_code"})
	})
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	conn, err := Dial(ctx, wsURL(srv.URL))
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()
	if err := conn.SendRegister("123456", "h", "full"); err != nil {
		t.Fatalf("SendRegister: %v", err)
	}
	msg, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if msg.Type != "error" || msg.Reason != "duplicate_code" {
		t.Fatalf("got %+v, want error/duplicate_code", msg)
	}
}
