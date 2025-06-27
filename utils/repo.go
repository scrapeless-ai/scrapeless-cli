package utils

import (
	"archive/zip"
	"fmt"
	"io"
	nethttp "net/http"
	"os"
	"path/filepath"
	"strings"
)

type Repo struct {
	URL         string // git addr，e.g. https://github.com/org/repo.git
	Branch      string // main、dev
	AccessToken string // GitHub Token
	TargetName  string // storage dir nane，update go.mod/package.json model/name
}

func CloneRepo(src Repo, localPath string) (string, error) {
	fmt.Printf("Template Source: %s\n", src.URL)
	localCodePath := filepath.Join(localPath, src.TargetName)

	owner, repoName := ParseGitURL(src.URL)
	ref := src.Branch

	zipURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/zipball/%s", owner, repoName, ref)
	req, err := nethttp.NewRequest("GET", zipURL, nil)
	if err != nil {
		fmt.Printf("Request failed: %v\n", err)
		return "", fmt.Errorf("create zip request failed: %v", err)
	}

	token := src.AccessToken
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := nethttp.DefaultClient.Do(req)
	if err != nil {
		fmt.Printf(" Request failed: %v\n", err)
		return "", fmt.Errorf("download git code failed: %v", err)
	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {
			return
		}
	}(resp.Body)

	if resp.StatusCode != nethttp.StatusOK {
		fmt.Printf("Request failed: %v", resp.Status)
		return "", fmt.Errorf("download git code failed: status code %d", resp.StatusCode)
	}

	zipFilePath := filepath.Join(localPath, "repo.zip")
	if err := os.MkdirAll(localPath, os.ModePerm); err != nil {
		return "", err
	}

	out, err := os.Create(zipFilePath)
	if err != nil {
		return "", err
	}
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return "", err
	}
	err = out.Close()
	if err != nil {
		return "", err
	}
	if err := UnzipToTargetDir(zipFilePath, localCodePath); err != nil {
		return "", err
	}
	defer func() {
		err := os.Remove("repo.zip")
		if err != nil {
			return
		}
	}()
	return localCodePath, nil
}

func ParseGitURL(url string) (owner, repo string) {
	url = strings.TrimSuffix(url, ".git")
	parts := strings.Split(url, "/")
	if len(parts) < 2 {
		return "", ""
	}
	repo = parts[len(parts)-1]
	owner = parts[len(parts)-2]
	return owner, repo
}

// UnzipToTargetDir unzip zipPath to targetDir
func UnzipToTargetDir(zipPath, targetDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer func(r *zip.ReadCloser) {
		err := r.Close()
		if err != nil {
			return
		}
	}(r)

	var rootPrefix string

	for _, f := range r.File {
		if rootPrefix == "" {
			parts := strings.SplitN(f.Name, "/", 2)
			if len(parts) == 2 {
				rootPrefix = parts[0] + "/"
			}
		}

		relPath := strings.TrimPrefix(f.Name, rootPrefix)
		if relPath == "" {
			continue
		}

		absPath := filepath.Join(targetDir, relPath)

		if f.FileInfo().IsDir() {
			err := os.MkdirAll(absPath, os.ModePerm)
			if err != nil {
				return err
			}
			continue
		}

		// create dir
		if err := os.MkdirAll(filepath.Dir(absPath), os.ModePerm); err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			return err
		}

		outFile, err := os.Create(absPath)
		if err != nil {
			err := rc.Close()
			if err != nil {
				return err
			}
			return err
		}

		_, err = io.Copy(outFile, rc)
		if err != nil {
			return err
		}
		err = outFile.Close()
		if err != nil {
			return err
		}
	}

	return nil
}
