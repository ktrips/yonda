"""読書記録アダプタの登録・ルックアップ"""
from adapters.base import LibraryAdapter
from adapters.setagaya import SetagayaAdapter
from adapters.audible import AudibleJPAdapter
from adapters.kindle import KindleAdapter

_ADAPTERS: dict[str, type[LibraryAdapter]] = {
    "setagaya": SetagayaAdapter,
    "audible_jp": AudibleJPAdapter,
    "kindle": KindleAdapter,
}


def get_adapter(library_id: str) -> LibraryAdapter:
    cls = _ADAPTERS.get(library_id)
    if cls is None:
        raise ValueError(f"未対応の図書館: {library_id}")
    return cls()


def list_libraries() -> list[dict]:
    result = []
    for lid, cls in _ADAPTERS.items():
        inst = cls()
        result.append({
            "id": inst.library_id,
            "name": inst.library_name,
            "url": inst.library_url,
        })
    return result
