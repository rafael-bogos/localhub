package ssh

import (
	"errors"
	"regexp"
	"strings"
)

// Everything that reaches a remote shell is built from constants plus values
// checked here and quoted. Nothing from the UI, and nothing parsed out of a
// remote command's output, is ever concatenated into a command unchecked.

// idPattern matches container names/IDs and image IDs/references. It must
// start with an alphanumeric, so a value can never be read as an option.
var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,254}$`)

var errBadID = errors.New("identificador inválido")

func validID(id string) error {
	if !idPattern.MatchString(id) {
		return errBadID
	}
	return nil
}

// validPID rejects PIDs the remote kill must never touch: 0, negative
// (process groups) and 1 (init).
func validPID(pid int32) error {
	if pid <= 1 {
		return errors.New("PID inválido")
	}
	return nil
}

// containerActions maps the actions the UI may ask for to the docker verb.
var containerActions = map[string]string{
	"start":   "start",
	"stop":    "stop",
	"restart": "restart",
	"remove":  "rm",
}

// shQuote quotes s as one POSIX shell word.
func shQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
