#[tokio::main]
async fn main() -> im_chat::error::Result<()> {
    im_chat::app::run().await
}
