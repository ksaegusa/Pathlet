use pathlet_core::{RouteResponse, calculate_route_json};
use std::{env, fs, process};

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();

    let input_path = match parse_input_path(&args) {
        Ok(path) => path,
        Err(message) => {
            eprintln!("{message}");
            print_usage();
            process::exit(2);
        }
    };

    let input = match fs::read_to_string(input_path) {
        Ok(input) => input,
        Err(error) => {
            eprintln!("failed to read input file: {error}");
            process::exit(2);
        }
    };

    let output = calculate_route_json(&input);
    let is_success = serde_json::from_str::<RouteResponse>(&output)
        .map(|response| response.ok)
        .unwrap_or(false);

    println!("{output}");
    process::exit(if is_success { 0 } else { 1 });
}

fn parse_input_path(args: &[String]) -> Result<&str, String> {
    match args {
        [command, flag, path] if command == "route" && flag == "--input" => Ok(path),
        [command, path] if command == "route" => Ok(path),
        [] => Err("missing command".into()),
        _ => Err("invalid arguments".into()),
    }
}

fn print_usage() {
    eprintln!("usage: pathlet route --input <request.json>");
}

#[cfg(test)]
mod tests {
    use super::parse_input_path;

    #[test]
    fn parses_explicit_input_flag() {
        let args = vec!["route".into(), "--input".into(), "request.json".into()];

        assert_eq!(parse_input_path(&args), Ok("request.json"));
    }

    #[test]
    fn parses_shorthand_input_path() {
        let args = vec!["route".into(), "request.json".into()];

        assert_eq!(parse_input_path(&args), Ok("request.json"));
    }

    #[test]
    fn rejects_unknown_args() {
        let args = vec!["route".into(), "--bad".into(), "request.json".into()];

        assert!(parse_input_path(&args).is_err());
    }
}
