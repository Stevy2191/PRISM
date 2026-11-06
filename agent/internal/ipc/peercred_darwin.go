package ipc

import "golang.org/x/sys/unix"

// SocketPath is the service's socket on macOS.
const SocketPath = "/var/run/prism-agent.sock"

// peerCredUID: the uid of the process at the other end (LOCAL_PEERCRED).
func peerCredUID(fd int) (uint32, error) {
	cred, err := unix.GetsockoptXucred(fd, unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	if err != nil {
		return 0, err
	}
	return cred.Uid, nil
}
