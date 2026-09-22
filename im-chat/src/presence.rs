mod manager;
mod route;

pub(crate) use manager::PresenceManager;
#[cfg(test)]
pub(crate) use route::PresenceRoute;
pub(crate) use route::RouteState;
