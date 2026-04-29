use std::path::Path;

pub fn find_lock_pid(dir: &Path) -> Option<u32> {
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let name = e.file_name();
        let name = name.to_string_lossy();
        if let Some(rest) = name.strip_prefix("inuse.") {
            if let Some(pid_str) = rest.strip_suffix(".lock") {
                if let Ok(pid) = pid_str.parse::<u32>() {
                    return Some(pid);
                }
            }
        }
    }
    None
}

#[cfg(unix)]
pub fn pid_alive(pid: u32) -> bool {
    unsafe {
        let r = libc::kill(pid as i32, 0);
        r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

#[cfg(not(unix))]
pub fn pid_alive(_pid: u32) -> bool {
    false
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiveState {
    Active,
    Stale,
    NoLock,
}

pub fn liveness(dir: &Path) -> LiveState {
    match find_lock_pid(dir) {
        None => LiveState::NoLock,
        Some(pid) => {
            if pid_alive(pid) {
                LiveState::Active
            } else {
                LiveState::Stale
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn fixture(p: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/copilot")
            .join(p)
    }
    #[test]
    fn finds_pid_from_lock_filename() {
        assert_eq!(
            find_lock_pid(&fixture("4dac1bf8-ee21-4659-bc60-00aad57573fb")),
            Some(99999)
        );
    }
    #[test]
    fn pid_99999_is_almost_certainly_dead() {
        assert!(!pid_alive(99999));
    }
    #[test]
    fn liveness_reports_stale_for_dead_pid() {
        assert_eq!(
            liveness(&fixture("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")),
            LiveState::Stale
        );
    }
}
