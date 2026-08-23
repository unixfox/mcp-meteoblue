# mcp-meteoblue

An MCP server for the [meteoblue Weather API](https://docs.meteoblue.com/en/weather-apis/introduction/overview), written in JavaScript. It lets MCP clients search for locations, fetch forecasts using packages available through the Free Weather API, and request forecast meteogram images.

## Tools

- `search_locations` resolves cities, postal codes, and IATA/ICAO airport codes with meteoblue Location Search.
- `get_forecast` accepts either a place name or coordinates and returns forecast JSON. It defaults to current, hourly, and daily weather.
- `get_forecast_image` accepts either a place name or coordinates and returns a forecast image directly to the MCP client.

Place names passed to forecast or image tools are always resolved through the official meteoblue Location Search API. Forecast package inputs are restricted to the packages listed in the Free Weather API documentation.

> [!NOTE]
> meteoblue's current Free Weather API documentation says that images require a higher access level. The image tool is included for keys with an Image API entitlement and will return a clear authorization error otherwise.

## Requirements

- Node.js 20 or newer
- A [meteoblue API key](https://www.meteoblue.com/en/weather-api)

Keep the key private. This server reads it from `METEOBLUE_API_KEY`; it is never part of the package or MCP tool arguments.

## Run from npm

Add this stdio server to your MCP client configuration:

```json
{
  "mcpServers": {
    "meteoblue": {
      "command": "npx",
      "args": ["-y", "mcp-meteoblue"],
      "env": {
        "METEOBLUE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Or run it directly:

```sh
METEOBLUE_API_KEY=your_api_key_here npx -y mcp-meteoblue
```

The server uses stdio, so it intentionally produces no normal terminal output while it waits for an MCP client.

## Docker

Build the image locally:

```sh
docker build -t mcp-meteoblue .
```

Configure a Docker-based stdio server in your MCP client:

```json
{
  "mcpServers": {
    "meteoblue": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "--env",
        "METEOBLUE_API_KEY",
        "mcp-meteoblue"
      ],
      "env": {
        "METEOBLUE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

The container runs as the unprivileged `node` user. Keep stdin open with `-i` because MCP communication uses stdio.

## Develop locally

```sh
npm install
npm test
METEOBLUE_API_KEY=your_api_key_here npm start
```

Point an MCP client at `node /absolute/path/to/mcp-meteoblue/src/index.js` and set the environment variable in that client's configuration.

## Releases

GitHub Actions runs the test suite and validates the npm tarball on Node.js 20, 22, 24, and 26 for every push and pull request. Dependabot checks npm and GitHub Actions dependencies weekly.

Pushing a `v*` Git tag triggers `.github/workflows/publish.yml`. The workflow uses npm trusted publishing (OIDC) and automatically attaches provenance. Configure the npm trusted publisher with:

- GitHub owner: `unixfox`
- Repository: `mcp-meteoblue`
- Workflow: `publish.yml`
- Environment: `npm`

No npm token is stored in GitHub when trusted publishing is configured.

## API scope

The server calls only:

- `https://www.meteoblue.com/{language}/server/search/query3`
- `https://my.meteoblue.com/packages/{packages}`
- `https://my.meteoblue.com/images/{forecast-image-type}`

It does not expose meteoblue History, Dataset, Maps, Measurements, or other APIs.

## License

MIT
