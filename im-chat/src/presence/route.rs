use super::PresenceManager;
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PresenceRoute {
    pub(crate) node_id: String,
    pub(crate) connection_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum RouteState {
    Offline,
    Online(PresenceRoute),
    Invalid,
}

impl PresenceManager {
    pub(crate) async fn read_route(&self, user_id: u64) -> Result<RouteState, redis::RedisError> {
        let mut connection = self.client.get_multiplexed_async_connection().await?;
        let result: Result<HashMap<Vec<u8>, Vec<u8>>, _> = redis::cmd("HGETALL")
            .arg(format!("presence:user:{user_id}"))
            .query_async(&mut connection)
            .await;
        match result {
            Ok(fields) => {
                let fields: Result<HashMap<String, String>, _> = fields
                    .into_iter()
                    .map(|(key, value)| Ok((String::from_utf8(key)?, String::from_utf8(value)?)))
                    .collect::<Result<_, std::string::FromUtf8Error>>();
                Ok(match fields {
                    Ok(fields) => parse_route(user_id, fields),
                    Err(_) => RouteState::Invalid,
                })
            }
            // A damaged value at one user's key is not a Redis outage.
            Err(error) if error.code() == Some("WRONGTYPE") => Ok(RouteState::Invalid),
            Err(error) => Err(error),
        }
    }
}

fn parse_route(user_id: u64, mut fields: HashMap<String, String>) -> RouteState {
    if fields.is_empty() {
        return RouteState::Offline;
    }
    let matches_user = fields
        .get("user_id")
        .and_then(|value| value.parse::<u64>().ok())
        == Some(user_id);
    let Some(node_id) = fields
        .remove("node_id")
        .filter(|value| !value.trim().is_empty())
    else {
        return RouteState::Invalid;
    };
    let Some(connection_id) = fields
        .remove("connection_id")
        .filter(|value| !value.trim().is_empty())
    else {
        return RouteState::Invalid;
    };
    if !matches_user {
        return RouteState::Invalid;
    }
    RouteState::Online(PresenceRoute {
        node_id,
        connection_id,
    })
}

#[cfg(test)]
#[path = "route_tests.rs"]
mod tests;
