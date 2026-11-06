package ipc

import "golang.org/x/sys/unix"

// SocketPath is the service's socket on Linux (/run is root's tmpfs).
const SocketPath = "/run/prism-agent.sock"

// peerCredUID: the uid of the process at the other end (SO_PEERCRED).
func peerCredUID(fd int) (uint32, error) {
	cred, err := unix.GetsockoptUcred(fd, unix.SOL_SOCKET, unix.SO_PEERCRED)
	if err != nil {
		return 0, err
	}
	return cred.Uid, nil
}
