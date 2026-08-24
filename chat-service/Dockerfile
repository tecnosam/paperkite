# syntax=docker/dockerfile:1

FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/chat-service-server ./cmd/server

# distroless: no shell, no package manager, just the binary and CA certs.
# The server itself creates its data directory on first run (see
# internal/username/registry.go), so nothing else needs to exist here.
FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=build /out/chat-service-server /usr/local/bin/chat-service-server

# Override with a mounted volume path if you want the username claims
# log to survive container recreation, e.g.
# `-v paperkite-data:/app/data -e CHAT_USERNAMES_FILE=/app/data/usernames.log`.
ENV CHAT_USERNAMES_FILE=/app/data/usernames.log

EXPOSE 8080 50051
ENTRYPOINT ["/usr/local/bin/chat-service-server"]
