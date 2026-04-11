use include_dir::{Dir, include_dir};
use std::borrow::Cow;
use std::env;
use std::process;
use tiny_http::{Header, Response, Server, StatusCode};

static DIST: Dir<'_> = include_dir!("$PATHLET_DIST_DIR");

#[derive(Debug)]
struct Config {
    host: String,
    port: u16,
    open_browser: bool,
}

fn main() {
    let config = match parse_args(env::args().skip(1)) {
        Ok(config) => config,
        Err(message) => {
            eprintln!("{message}");
            print_usage();
            process::exit(2);
        }
    };

    let address = format!("{}:{}", config.host, config.port);
    let server = match Server::http(&address) {
        Ok(server) => server,
        Err(error) => {
            eprintln!("failed to start server at {address}: {error}");
            process::exit(1);
        }
    };

    let url = format!("http://{}", server.server_addr());
    println!("pathlet is running at {url}");
    println!("press Ctrl+C to stop");

    if config.open_browser {
        if let Err(error) = webbrowser::open(&url) {
            eprintln!("failed to open browser: {error}");
        }
    }

    for request in server.incoming_requests() {
        serve_request(request);
    }
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<Config, String> {
    let mut config = Config {
        host: "127.0.0.1".into(),
        port: 0,
        open_browser: true,
    };

    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--host" => {
                config.host = args
                    .next()
                    .ok_or_else(|| "--host requires a value".to_string())?;
            }
            "--port" => {
                let port = args
                    .next()
                    .ok_or_else(|| "--port requires a value".to_string())?;
                config.port = port
                    .parse()
                    .map_err(|_| format!("invalid --port value '{port}'"))?;
            }
            "--no-open" => {
                config.open_browser = false;
            }
            "--help" | "-h" => {
                print_usage();
                process::exit(0);
            }
            _ => return Err(format!("unknown argument '{arg}'")),
        }
    }

    Ok(config)
}

fn print_usage() {
    eprintln!("usage: pathlet [--host 127.0.0.1] [--port 0] [--no-open]");
}

fn serve_request(request: tiny_http::Request) {
    let path = request_path(request.url());
    let (file, response_path) = match DIST.get_file(path.as_ref()) {
        Some(file) => (Some(file), path.as_ref()),
        None => (DIST.get_file("index.html"), "index.html"),
    };

    let Some(file) = file else {
        let _ = request.respond(
            Response::from_string("not found").with_status_code(StatusCode(404)),
        );
        return;
    };

    let response = Response::from_data(file.contents().to_vec())
        .with_header(content_type_header(response_path));
    let _ = request.respond(response);
}

fn request_path(url: &str) -> Cow<'_, str> {
    let path = url.split(['?', '#']).next().unwrap_or("/");
    let path = path.trim_start_matches('/');

    if path.is_empty() || path.contains("..") {
        Cow::Borrowed("index.html")
    } else {
        Cow::Owned(path.to_string())
    }
}

fn content_type_header(path: &str) -> Header {
    let content_type = match path.rsplit('.').next().unwrap_or_default() {
        "css" => "text/css; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    };

    Header::from_bytes("Content-Type", content_type).expect("valid content-type header")
}

#[cfg(test)]
mod tests {
    use super::{parse_args, request_path};

    #[test]
    fn defaults_to_loopback_ephemeral_port_and_open_browser() {
        let config = parse_args(Vec::new()).unwrap();

        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 0);
        assert!(config.open_browser);
    }

    #[test]
    fn parses_host_port_and_no_open() {
        let config = parse_args(vec![
            "--host".into(),
            "0.0.0.0".into(),
            "--port".into(),
            "8080".into(),
            "--no-open".into(),
        ])
        .unwrap();

        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, 8080);
        assert!(!config.open_browser);
    }

    #[test]
    fn maps_empty_and_suspicious_paths_to_index() {
        assert_eq!(request_path("/"), "index.html");
        assert_eq!(request_path("/../secret"), "index.html");
    }

    #[test]
    fn strips_query_string() {
        assert_eq!(request_path("/assets/app.js?v=1"), "assets/app.js");
    }
}
