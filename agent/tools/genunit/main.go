// genunit writes packaging/linux/prism-agent.service from service.Unit, so
// the packages ship exactly the unit the agent writes (run from agent/).
package main

import (
	"log"
	"os"

	"github.com/stevy2191/prism/agent/internal/service"
)

func main() {
	if err := os.WriteFile("packaging/linux/prism-agent.service", service.Unit(service.LinuxAgentBin), 0o644); err != nil {
		log.Fatal(err)
	}
}
