pub mod commands;
pub mod error;
pub mod git;
pub mod gitops;
pub mod models;
pub mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let recents = state::load_recents(app.handle());
            app.manage(state::AppState::new(recents));
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<state::AppState>();
                commands::terminal::close_all_terminals(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::repo::bootstrap,
            commands::repo::open_repository,
            commands::repo::refresh_repo,
            commands::repo::init_repository,
            commands::repo::clone_repository,
            commands::repo::list_recents,
            commands::repo::remove_recent,
            commands::history::get_history,
            commands::history::get_commit_details,
            commands::history::get_file_diff,
            commands::history::get_blame,
            commands::history::get_file_history,
            commands::changes::stage_paths,
            commands::changes::stage_all,
            commands::changes::unstage_paths,
            commands::changes::unstage_all,
            commands::changes::discard_paths,
            commands::changes::discard_all,
            commands::changes::apply_patch,
            commands::changes::commit_changes,
            commands::branches::list_branches,
            commands::branches::list_tags,
            commands::branches::list_stashes,
            commands::branches::list_worktrees,
            commands::branches::list_remotes,
            commands::branches::checkout_branch,
            commands::branches::create_branch,
            commands::branches::rename_branch,
            commands::branches::delete_branch,
            commands::branches::create_tag,
            commands::branches::delete_tag,
            commands::branches::create_stash,
            commands::branches::apply_stash,
            commands::branches::drop_stash,
            commands::branches::add_remote,
            commands::branches::remove_remote,
            commands::branches::merge_branch,
            commands::branches::abort_merge,
            commands::branches::rebase_onto,
            commands::branches::abort_rebase,
            commands::branches::cherry_pick_commit,
            commands::branches::abort_cherry_pick,
            commands::branches::revert_commit,
            commands::branches::abort_revert,
            commands::branches::reset_to_commit,
            commands::branches::get_conflict_sides,
            commands::branches::resolve_with_side,
            commands::branches::mark_resolved,
            commands::branches::get_undo_status,
            commands::branches::undo_last,
            commands::branches::redo_last,
            commands::remote::fetch_remote,
            commands::remote::pull_remote,
            commands::remote::push_remote,
            commands::remote::cancel_operation,
            commands::terminal::spawn_terminal,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar Git Leviathan");
}
