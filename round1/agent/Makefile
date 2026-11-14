.PHONY: build run tidy clean

BINARY := peershell
PKG    := ./cmd/peershell

build:
	go build -o $(BINARY) $(PKG)

run:
	go run $(PKG)

tidy:
	go mod tidy

clean:
	rm -f $(BINARY)
