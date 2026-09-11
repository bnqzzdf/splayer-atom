use thiserror::Error;

#[derive(Error, Debug)]
pub enum StreamingError {
    #[error("HTTP request error: {0}")]
    Reqwest(#[from] reqwest::Error),

    #[error("API error ({status}): {message}")]
    Api { status: u16, message: String },

    #[error("{source}")]
    WithRefreshedAuth {
        #[source]
        source: Box<StreamingError>,
        access_token: String,
        refresh_token: Option<String>,
        expires_at: Option<u64>,
    },

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Invalid param: {0}")]
    InvalidParam(String),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Other error: {0}")]
    Other(String),
}
