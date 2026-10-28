//! Windows single-instance guard for the native client.

#[cfg(target_os = "windows")]
pub struct SingleInstance {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(target_os = "windows")]
impl Drop for SingleInstance {
    fn drop(&mut self) {
        // SAFETY: the handle was returned by CreateMutexW and is owned by
        // this guard on the thread that acquired the mutex.
        if !self.handle.is_null() {
            unsafe {
                windows_sys::Win32::System::Threading::ReleaseMutex(self.handle);
                windows_sys::Win32::Foundation::CloseHandle(self.handle);
            }
        }
    }
}

/// Acquire the Mihonban process mutex. `None` means another client instance
/// already owns it and the caller should exit without creating another tray.
#[cfg(target_os = "windows")]
pub fn acquire() -> Option<SingleInstance> {
    acquire_named("Global\\Mihonban.Native.SingleInstance")
}

#[cfg(target_os = "windows")]
fn acquire_named(name: &str) -> Option<SingleInstance> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{
        GetLastError, ERROR_ALREADY_EXISTS, WAIT_ABANDONED, WAIT_OBJECT_0,
    };
    use windows_sys::Win32::System::Threading::{CreateMutexW, WaitForSingleObject};

    let name: Vec<u16> = std::ffi::OsStr::new(name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: `name` is a valid nul-terminated UTF-16 string and the null
    // security-attributes pointer requests the process default descriptor.
    let handle = unsafe { CreateMutexW(std::ptr::null(), 1, name.as_ptr()) };
    if handle.is_null() {
        // Do not start without the guard: doing so would recreate the
        // multiple-hidden-process tray bug this mutex is meant to prevent.
        return None;
    }
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        // Initial ownership is ignored for existing objects. An unowned or
        // abandoned mutex can survive a crashed client while another handle exists.
        // SAFETY: this process owns the newly opened handle and never blocks here.
        let result = unsafe { WaitForSingleObject(handle, 0) };
        if result != WAIT_OBJECT_0 && result != WAIT_ABANDONED {
            // SAFETY: the unsuccessful wait did not acquire mutex ownership.
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(handle);
            }
            return None;
        }
    }
    Some(SingleInstance { handle })
}

#[cfg(not(target_os = "windows"))]
pub struct SingleInstance;

#[cfg(not(target_os = "windows"))]
pub fn acquire() -> Option<SingleInstance> {
    Some(SingleInstance)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::atomic::{AtomicU64, Ordering};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    static NEXT_MUTEX: AtomicU64 = AtomicU64::new(0);

    struct RetainedHandle(HANDLE);

    impl Drop for RetainedHandle {
        fn drop(&mut self) {
            // SAFETY: this helper only owns a valid handle, never mutex ownership.
            unsafe { CloseHandle(self.0) };
        }
    }

    fn unique_name() -> String {
        format!(
            "Local\\Mihonban.Native.Tests.{}.{}",
            std::process::id(),
            NEXT_MUTEX.fetch_add(1, Ordering::Relaxed)
        )
    }

    fn retain_unowned_handle(name: &str) -> RetainedHandle {
        let name: Vec<u16> = std::ffi::OsStr::new(name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: the name is nul-terminated and default security is requested.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        assert!(!handle.is_null());
        RetainedHandle(handle)
    }

    fn another_thread_can_acquire(name: &str) -> bool {
        let name = name.to_owned();
        std::thread::spawn(move || acquire_named(&name).is_some())
            .join()
            .expect("the competing thread should complete")
    }

    #[test]
    fn active_owner_blocks_a_competing_instance() {
        let name = unique_name();
        let _owner = acquire_named(&name).expect("the first instance should acquire ownership");
        assert!(!another_thread_can_acquire(&name));
    }

    #[test]
    fn releasing_ownership_allows_restart_while_the_object_still_exists() {
        let name = unique_name();
        let owner = acquire_named(&name).expect("the first instance should acquire ownership");
        let _retained = retain_unowned_handle(&name);
        drop(owner);
        assert!(another_thread_can_acquire(&name));
    }

    #[test]
    fn an_existing_unowned_object_can_be_taken_over() {
        let name = unique_name();
        let _retained = retain_unowned_handle(&name);
        let _owner = acquire_named(&name).expect("an unowned object must not prevent startup");
        assert!(!another_thread_can_acquire(&name));
    }

    #[test]
    fn an_abandoned_owner_can_be_recovered() {
        let name = unique_name();
        let abandoned_name = name.clone();
        let leaked_handle = std::thread::spawn(move || {
            let owner = acquire_named(&abandoned_name).expect("the owner should acquire the mutex");
            let handle = owner.handle as usize;
            // Simulate a crashed owner: the thread exits without releasing the mutex.
            std::mem::forget(owner);
            handle
        })
        .join()
        .expect("the owner thread should exit");
        let _retained = RetainedHandle(leaked_handle as HANDLE);
        let _recovered = acquire_named(&name).expect("an abandoned mutex must permit recovery");
        assert!(!another_thread_can_acquire(&name));
    }
}
