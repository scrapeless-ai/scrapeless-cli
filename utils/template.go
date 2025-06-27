package utils

import (
	"fmt"
	"github.com/tidwall/sjson"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

func CreateTemplate(url gitUrl, targetName string, language Language) {
	if !isValidDirName(targetName) {
		fmt.Printf("Illegal project name: %s", targetName)
		return
	}

	cwd, err := os.Getwd()
	if err != nil {
		log.Println("Unable to get the current working directory：" + err.Error())
		return
	}
	targetPath := filepath.Join(cwd, targetName)
	if _, err := os.Stat(targetPath); err == nil {
		fmt.Printf("⚠️ %s already exists\n", targetName)
		return
	} else if !os.IsNotExist(err) {
		fmt.Printf("❌ Failed to check if %s exists: %v\n", targetName, err)
		return
	}
	repo, err := CloneRepo(Repo{
		URL:         string(url),
		Branch:      "main",
		AccessToken: "",
		TargetName:  targetName,
	}, cwd)
	if err != nil {
		fmt.Printf("Error: %v", err)
		return
	}
	// update go.mod/package.json
	err = updateModOrPackage(repo, targetName, language)
	if err != nil {
		fmt.Printf("Template generate failed: %v\n", err)
		return
	}
	err = updateActorJson(repo, targetName)
	if err != nil {
		fmt.Printf("Template generate failed: %v\n", err)
		return
	}
	fmt.Printf("Template generated in %s\n", repo)
}

func updateActorJson(repo string, name string) error {
	path := filepath.Join(repo, ".actor", "actor.json")

	// read origin JSON file
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("❌ Failed to read actor.json: %v", err)
	}

	updated, err := sjson.SetBytes(content, "name", name)
	if err != nil {
		return fmt.Errorf("❌ Failed to update actor.json: %v", err)
	}

	if err := os.WriteFile(path, updated, 0644); err != nil {
		return fmt.Errorf("❌ Failed to write actor.json: %v", err)
	}
	return nil
}

func updateModOrPackage(dir, targetName string, language Language) error {
	var err error
	switch language {
	case NodeJS, TS:
		err = updatePackageFile(dir, targetName)
	case Golang:
		err = updateModFile(dir, targetName)
	default:
		err = fmt.Errorf("unsupport language: %s", language)
	}
	return err
}

func updatePackageFile(dir, name string) error {
	packagePath := filepath.Join(dir, "package.json")
	content, err := os.ReadFile(packagePath)
	if err != nil {
		return fmt.Errorf("❌ Failed to read package.json: %v", err)
	}
	updated, err := sjson.SetBytes(content, "name", name)
	if err != nil {
		return fmt.Errorf("❌ Failed to update actor.json: %v", err)
	}

	if err := os.WriteFile(packagePath, updated, 0644); err != nil {
		return fmt.Errorf("❌ Failed to write package.json: %v", err)
	}

	return nil
}

func updateModFile(dir, name string) error {
	modPath := filepath.Join(dir, "go.mod")
	content, err := os.ReadFile(modPath)
	if err != nil {
		return fmt.Errorf("❌ Failed to read go.mod: %v", err)
	}

	lines := strings.Split(string(content), "\n")
	for i, line := range lines {
		if strings.HasPrefix(line, "module ") {
			lines[i] = "module " + name
			break
		}
	}

	newContent := strings.Join(lines, "\n")
	if err := os.WriteFile(modPath, []byte(newContent), 0644); err != nil {
		return fmt.Errorf("❌ Failed to write go.mod: %v", err)
	}
	return nil
}

var dirNameRegexp = regexp.MustCompile(`^[a-z_-]+$`)

func isValidDirName(name string) bool {
	return dirNameRegexp.MatchString(name)
}
