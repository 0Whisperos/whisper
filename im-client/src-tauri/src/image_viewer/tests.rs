use super::*;

fn input(id: &str) -> ViewerImageInput {
    ViewerImageInput {
        id: id.into(),
        message_id: "08f740ce-7ae3-49ed-a496-224074bda27e".into(),
        attachment_id: "6b916932-0738-48f2-b62e-f3f212472d73".into(),
    }
}

fn state() -> SessionState {
    SessionState {
        api_base_url: "https://example.test".into(),
        user_id: 2,
        session: ViewerSession {
            session_id: "session".into(),
            version: 3,
            conversation_id: 4,
            current_index: 1,
            images: ["a", "b", "c"]
                .into_iter()
                .map(|id| ViewerImage {
                    input: input(id),
                    asset_url: None,
                })
                .collect(),
        },
    }
}

#[test]
fn validates_identifiers_and_keeps_duplicate_attachments_as_distinct_images() {
    // 测试目标：拒绝非法及重复序列项 ID，允许同一附件在不同消息位置出现。
    // 构造方法：分别验证两个不同图片项、重复图片项、非法消息和附件 UUID。
    // 输入数据：a/b 共用附件 UUID；a/a 重复 ID；message_id 或 attachment_id 为 bad。
    // 预期行为：只有两个不同图片项通过，其他输入返回 invalid_viewer_session。
    assert!(validate_images(&[input("a"), input("b")]).is_ok());
    assert_eq!(
        validate_images(&[input("a"), input("a")]),
        Err(ImageError::InvalidViewerSession)
    );
    for invalid_message in [true, false] {
        let mut image = input("a");
        if invalid_message {
            image.message_id = "bad".into();
        } else {
            image.attachment_id = "bad".into();
        }
        assert_eq!(
            validate_images(&[image]),
            Err(ImageError::InvalidViewerSession)
        );
    }
}

#[test]
fn retains_current_item_when_earlier_history_is_added() {
    // 测试目标：历史加载插入序列头部后仍保持当前图片并递增版本。
    // 构造方法：构造 a/b/c 且选中 b，替换为 earlier/a/b/c。
    // 输入数据：当前索引 1、版本 3、新图片序列 four items。
    // 预期行为：新索引为 2，session ID 不变，版本变为 4。
    let old = state();
    let images = ["earlier", "a", "b", "c"]
        .into_iter()
        .map(|id| ViewerImage {
            input: input(id),
            asset_url: None,
        })
        .collect();
    let next = updated_session(&old, images).unwrap();
    assert_eq!(next.session.current_index, 2);
    assert_eq!(next.session.version, 4);
    assert_eq!(next.session.session_id, old.session.session_id);
}

#[test]
fn removing_current_item_prefers_next_then_previous_and_empty_closes() {
    // 测试目标：移除当前图片时优先选下一存活项，末项移除回退前项，空序列关闭。
    // 构造方法：选中 b 的 a/b/c 序列依次替换为 a/c、a 和空列表。
    // 输入数据：剩余项分别为 [a,c]、[a]、[]。
    // 预期行为：分别选中 c、a，最后返回 None。
    let old = state();
    let remaining = |ids: &[&str]| {
        ids.iter()
            .map(|id| ViewerImage {
                input: input(id),
                asset_url: None,
            })
            .collect()
    };
    let next = updated_session(&old, remaining(&["a", "c"])).unwrap();
    assert_eq!(
        next.session.images[next.session.current_index].input.id,
        "c"
    );
    let previous = updated_session(&old, remaining(&["a"])).unwrap();
    assert_eq!(
        previous.session.images[previous.session.current_index]
            .input
            .id,
        "a"
    );
    assert!(updated_session(&old, Vec::new()).is_none());
}

#[test]
fn replacement_and_cleanup_revoke_stale_session_snapshots() {
    // 测试目标：session 替换和窗口销毁后旧标识无法取得缓存命名空间。
    // 构造方法：保存 session，再替换新 ID，然后清空 store。
    // 输入数据：旧 ID session、新 ID replacement。
    // 预期行为：当前快照可读取，旧 ID 被拒绝，清理后无当前 session。
    let store = ViewerStore::default();
    assert!(store.snapshot(None).unwrap().is_none());
    store.replace(state()).unwrap();
    assert!(store.snapshot(Some("session")).unwrap().is_some());
    let mut replacement = state();
    replacement.session.session_id = "replacement".into();
    store.replace(replacement).unwrap();
    assert!(matches!(
        store.snapshot(Some("session")),
        Err(ImageError::ViewerSessionExpired)
    ));
    store.clear();
    assert!(store.snapshot(None).unwrap().is_none());
    assert!(matches!(
        store.snapshot(Some("replacement")),
        Err(ImageError::ViewerSessionExpired)
    ));
}

#[test]
fn native_close_during_async_update_cannot_resurrect_session() {
    // 测试目标：原生窗口关闭后，缓存读取完成的旧 update 无法复活已清除 session。
    // 构造方法：保存 session 并取得快照，模拟原生关闭清理，再尝试提交该快照。
    // 输入数据：有效 session 快照及随后发生的 clear。
    // 预期行为：replace_current 返回 ViewerSessionExpired，store 仍为空。
    let store = ViewerStore::default();
    store.replace(state()).unwrap();
    let pending = store.snapshot(None).unwrap().unwrap();
    store.clear();
    assert_eq!(
        store.replace_current(pending),
        Err(ImageError::ViewerSessionExpired)
    );
    assert!(store.snapshot(None).unwrap().is_none());
}

#[test]
fn main_destruction_rejects_inflight_and_future_viewer_preparation() {
    // 测试目标：主窗口销毁禁止异步 prepare 或 update 重新建立孤立查看器状态。
    // 构造方法：初始化 session，模拟主窗口 Destroyed，然后提交新 session 和旧快照。
    // 输入数据：旧 session、mainClosed 终态、新 session。
    // 预期行为：state 被清空且保持关闭；replace 和 replace_current 都被拒绝。
    let store = ViewerStore::default();
    store.replace(state()).unwrap();
    store.close_main();
    assert!(store.main_closed());
    assert_eq!(store.replace(state()), Err(ImageError::OperationNotAllowed));
    assert_eq!(
        store.replace_current(state()),
        Err(ImageError::ViewerSessionExpired)
    );
    assert!(store.snapshot(None).unwrap().is_none());
}

#[test]
fn session_snapshot_has_only_public_camel_case_fields_and_nullable_asset_url() {
    // 测试目标：viewer 快照遵循 IPC 合同，不把内部用户命名空间泄漏为 DTO 字段。
    // 构造方法：序列化有三个未缓存图片项的内部 session。
    // 输入数据：session、conversationId=4、currentIndex=1、assetUrl=None。
    // 预期行为：sessionId/currentIndex/attachmentId 等 camelCase 字段存在，assetUrl 为 null，没有 userId/apiBaseUrl。
    let json = serde_json::to_value(state().session).unwrap();
    assert_eq!(json["sessionId"], "session");
    assert_eq!(json["currentIndex"], 1);
    assert_eq!(json["images"][0]["id"], "a");
    assert!(json["images"][0]["assetUrl"].is_null());
    assert!(json.get("apiBaseUrl").is_none() && json.get("userId").is_none());
}

#[test]
fn delayed_destroyed_event_clears_only_its_original_window_generation() {
    // 测试目标：旧窗口异步 Destroyed 晚于同标签新窗口创建时不能清理新 session。
    // 构造方法：登记旧窗口generation并清旧session，然后创建新session与新generation，最后投递旧Destroyed。
    // 输入数据：两个不同 UUID generation、同窗口标签、新session。
    // 预期行为：旧Destroyed被忽略，新Destroyed才清理当前session。
    let store = ViewerStore::default();
    let old = Uuid::new_v4();
    let new = Uuid::new_v4();
    store.window_ready(old);
    store.replace(state()).unwrap();
    store.clear();
    let mut replacement = state();
    replacement.session.session_id = "new-session".into();
    store.replace(replacement).unwrap();
    store.window_ready(new);
    store.window_destroyed(old);
    assert!(store.snapshot(Some("new-session")).unwrap().is_some());
    store.window_destroyed(new);
    assert!(store.snapshot(None).unwrap().is_none());
}

#[test]
fn closing_holds_mutation_gate_until_native_destroyed_without_blocking_callback() {
    // 测试目标：destroy排队期间阻止新prepare复用即将关闭的窗口，同时native事件无需取得异步锁。
    // 构造方法：手动poll持有mutation锁的关闭future，模拟事件回调，再次poll完成。
    // 输入数据：一个已登记窗口generation及迟到的window_destroyed通知。
    // 预期行为：通知前future为Pending且mutation不可取得；事件回调可执行，通知后释放mutation锁。
    use std::future::Future;
    use std::task::{Context, Poll, Waker};
    let store = ViewerStore::default();
    let generation = Uuid::new_v4();
    store.window_ready(generation);
    let closing = async {
        let _guard = store.mutation.lock().await;
        store.wait_window_destroyed(generation).await;
    };
    let mut closing = std::pin::pin!(closing);
    let mut context = Context::from_waker(Waker::noop());
    assert!(matches!(closing.as_mut().poll(&mut context), Poll::Pending));
    assert!(store.mutation.try_lock().is_err());
    store.window_destroyed(generation);
    assert!(matches!(
        closing.as_mut().poll(&mut context),
        Poll::Ready(())
    ));
    assert!(store.mutation.try_lock().is_ok());
}
