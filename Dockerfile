FROM golang:1.26-alpine AS build
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /wellspan ./cmd/wellspan

FROM alpine:3.23
RUN addgroup -S -g 10001 wellspan && adduser -S -D -u 10001 -G wellspan wellspan && mkdir -p /app/src /data && chown -R wellspan:wellspan /data
COPY --from=build /wellspan /app/wellspan
COPY index.html /app/index.html
COPY src/ /app/src/
COPY sw.js manifest.webmanifest /app/
COPY icons/ /app/icons/
USER wellspan
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/app/wellspan", "-healthcheck"]
ENTRYPOINT ["/app/wellspan"]
