package utils

import "strings"

type gitUrl string
type Project string
type Language string

const (
	NodeJS Language = "js"
	TS     Language = "ts"
	Golang Language = "golang"
)

const (
	URLStartWithGolang gitUrl = "https://github.com/scrapeless-ai/actor-template-go.git"
	URLStartWithNodeJS gitUrl = "https://github.com/scrapeless-ai/actor-template-node.git"
	URLStartWithTS     gitUrl = "https://github.com/scrapeless-ai/actor-template-ts.git"
)

const (
	ProjectStartWithGolang Project = "start_with_golang"
	ProjectStartWithNodeJS Project = "start_with_node_js"
	ProjectStartWithTS     Project = "start_with_ts"
)

var (
	ProjectMap = map[Project]gitUrl{
		ProjectStartWithGolang: URLStartWithGolang,
		ProjectStartWithNodeJS: URLStartWithNodeJS,
		ProjectStartWithTS:     URLStartWithTS,
	}
)

var (
	DevLanguage = map[Project]Language{
		ProjectStartWithGolang: Golang,
		ProjectStartWithNodeJS: NodeJS,
		ProjectStartWithTS:     TS,
	}
)

func GetProjectsStr() string {
	var projects []string
	for project := range ProjectMap {
		projects = append(projects, string(project))
	}
	return strings.Join(projects, "、")
}

var AllProjects []string

func init() {
	for project := range ProjectMap {
		AllProjects = append(AllProjects, string(project))
	}
}
