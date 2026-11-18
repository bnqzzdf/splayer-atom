use std::cell::UnsafeCell;
use std::ffi::c_void;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

struct Allocation<T> {
    references: AtomicUsize,
    data: UnsafeCell<T>,
}

// 只有解码线程能修改载荷，外部引用归零后才能复用。
unsafe impl<T: Send> Sync for Allocation<T> {}

pub(crate) struct DirectStorage<T> {
    current: Arc<Allocation<T>>,
    retired: Vec<Arc<Allocation<T>>>,
}

impl<T> DirectStorage<T> {
    pub(crate) fn new(data: T) -> Self {
        Self {
            current: Self::allocate(data),
            retired: Vec::new(),
        }
    }

    fn allocate(data: T) -> Arc<Allocation<T>> {
        Arc::new(Allocation {
            references: AtomicUsize::new(0),
            data: UnsafeCell::new(data),
        })
    }

    pub(crate) fn retain(&self) -> *const c_void {
        self.current.references.fetch_add(1, Ordering::Relaxed);
        std::ptr::from_ref(&self.current.references).cast()
    }

    pub(crate) fn writable<E>(
        &mut self,
        allocate: impl FnOnce() -> Result<T, E>,
    ) -> Result<&mut T, E> {
        if self.current.references.load(Ordering::Acquire) != 0 {
            let next = match self
                .retired
                .iter()
                .position(|entry| entry.references.load(Ordering::Acquire) == 0)
            {
                Some(index) => self.retired.swap_remove(index),
                None => Self::allocate(allocate()?),
            };
            // SDK 仍可能读旧载荷，解码线程只复用没有外部引用的分配。
            self.retired
                .push(std::mem::replace(&mut self.current, next));
        }
        Ok(unsafe { &mut *self.current.data.get() })
    }

    pub(crate) fn writable_if_unretained(&mut self) -> Option<&mut T> {
        (self.current.references.load(Ordering::Acquire) == 0)
            .then(|| unsafe { &mut *self.current.data.get() })
    }

    #[cfg(test)]
    pub(crate) fn data(&self) -> &T {
        unsafe { &*self.current.data.get() }
    }
}

pub(crate) unsafe extern "C" fn change_diretta_block_ref(token: *const c_void, retain: bool) {
    let references = unsafe { &*token.cast::<AtomicUsize>() };
    if retain {
        references.fetch_add(1, Ordering::Relaxed);
    } else {
        references.fetch_sub(1, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoder_reuses_payload_only_after_the_last_packet_releases_it() {
        let mut storage = DirectStorage::new([1, 2, 3, 4]);
        let data = storage.data().as_ptr();
        let token = storage.retain();
        unsafe { change_diretta_block_ref(token, true) };

        *storage.writable(|| Ok::<_, ()>([0; 4])).unwrap() = [5, 6, 7, 8];
        assert_ne!(storage.data().as_ptr(), data);
        assert_eq!(unsafe { std::slice::from_raw_parts(data, 4) }, [1, 2, 3, 4]);
        unsafe { change_diretta_block_ref(token, false) };

        let second_token = storage.retain();
        storage.writable(|| Ok::<_, ()>([9; 4])).unwrap();
        assert_ne!(storage.data().as_ptr(), data);
        unsafe { change_diretta_block_ref(token, false) };

        let third_token = storage.retain();
        storage.writable(|| Err(())).unwrap();
        assert_eq!(storage.data().as_ptr(), data);
        unsafe {
            change_diretta_block_ref(second_token, false);
            change_diretta_block_ref(third_token, false);
        }
    }
}
