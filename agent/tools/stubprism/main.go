// stubprism is a tiny stand-in for PRISM, for the installer test in CI
// (.github/workflows/agent.yml): it enrols one device with the key given,
// checks each later request's signature against that device's key, and
// writes heartbeat.ok once a correctly signed heartbeat arrives. Not part
// of any package.
//
//	stubprism -addr 127.0.0.1:8765 -key pk_enr_ci -out C:\stub
package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8765", "listen address")
	key := flag.String("key", "pk_enr_ci", "the enrolment key to accept")
	out := flag.String("out", ".", "folder for heartbeat.ok and stub.log")
	flag.Parse()
	_ = os.MkdirAll(*out, 0o755)
	lf, _ := os.Create(filepath.Join(*out, "stub.log"))
	log.SetOutput(io.MultiWriter(os.Stderr, lf))

	var mu sync.Mutex
	var devicePub ed25519.PublicKey
	http.HandleFunc("/api/v1/agent/v1/enroll", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ EnrollKey, PublicKey, Platform, Arch, AgentVersion, Hostname string }
		_ = json.NewDecoder(r.Body).Decode(&req)
		log.Printf("enroll: platform=%s arch=%s version=%s host=%s", req.Platform, req.Arch, req.AgentVersion, req.Hostname)
		if req.EnrollKey != *key {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":true,"code":"ENROLL_KEY_INVALID","message":"That enrolment key is not valid"}`))
			return
		}
		pub, err := base64.StdEncoding.DecodeString(req.PublicKey)
		if err != nil || len(pub) != ed25519.PublicKeySize {
			w.WriteHeader(400)
			return
		}
		mu.Lock()
		devicePub = pub
		mu.Unlock()
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"deviceId":1,"updatePublicKey":"11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=","intervals":{"heartbeatSec":300,"inventorySec":21600}}`))
	})
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 2<<20))
		sum := sha256.Sum256(body)
		canon := r.Method + "\n" + r.URL.RequestURI() + "\n" + r.Header.Get("X-Prism-Timestamp") + "\n" + r.Header.Get("X-Prism-Nonce") + "\n" + hex.EncodeToString(sum[:])
		sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Prism-Signature"))
		mu.Lock()
		pub := devicePub
		mu.Unlock()
		if pub == nil || r.Header.Get("X-Prism-Device") != "1" || !ed25519.Verify(pub, []byte(canon), sig) {
			log.Printf("%s %s: bad signature", r.Method, r.URL.Path)
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":true,"code":"AGENT_UNAUTHORIZED"}`))
			return
		}
		log.Printf("%s %s: signed OK (%d bytes)", r.Method, r.URL.Path, len(body))
		switch r.URL.Path {
		case "/api/v1/agent/v1/heartbeat":
			_ = os.WriteFile(filepath.Join(*out, "heartbeat.ok"), body, 0o644)
			_, _ = w.Write([]byte(`{"update":null}`))
		case "/api/v1/agent/v1/inventory":
			_ = os.WriteFile(filepath.Join(*out, "inventory.json"), body, 0o644)
			_, _ = w.Write([]byte(`{"changedFields":[],"software":{"added":0,"removed":0}}`))
		default:
			w.WriteHeader(404)
		}
	})
	log.Printf("stub PRISM on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
