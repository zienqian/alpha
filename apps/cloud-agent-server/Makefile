.PHONY: run build test tidy vet clean

APP_NAME := cloud-agent-server

run:
	go run ./cmd/server

build:
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/$(APP_NAME) ./cmd/server

test:
	go test -v ./...

vet:
	go vet ./...

tidy:
	go mod tidy

clean:
	rm -rf bin data coverage.out
