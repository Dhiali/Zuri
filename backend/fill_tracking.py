"""Bounded ingestion of Alpaca fill activities into a transactional ledger."""
from typing import Callable, Protocol, TypedDict


class FillActivity(TypedDict):
    id: str
    order_id: str
    symbol: str
    side: str
    quantity: float
    price: float
    time: str


class FillAdapter(Protocol):
    def fill_activities(self, page_token: str | None = None, after: str | None = None) -> list[FillActivity]: ...


class AlpacaPaperAdapter(FillAdapter, Protocol):
    def account(self) -> dict: ...


class FillConnection(TypedDict):
    id: str
    user_id: str
    broker: str
    environment: str


class FillCursor(TypedDict):
    id: str
    user_id: str
    connection_id: str | None
    account_number: str
    starts_at: str
    cursor: str | None


def ingest_fill_pages(
    adapter: FillAdapter,
    cursor: str | None,
    starts_at: str,
    save_page: Callable[[str | None, str, list[FillActivity]], int],
    max_pages: int = 10,
) -> tuple[int, bool]:
    """Save each page before requesting the next; return inserted count and whether more work may remain."""
    if max_pages < 1:
        raise ValueError("max_pages must be at least one")
    total = 0
    for _ in range(max_pages):
        fills = adapter.fill_activities(page_token=cursor, after=starts_at)
        if not fills:
            return total, False
        next_cursor = fills[-1]["id"]
        if next_cursor == cursor:
            raise ValueError("Alpaca returned a non-advancing fill cursor")
        total += save_page(cursor, next_cursor, fills)
        cursor = next_cursor
        if len(fills) < 100:
            return total, False
    return total, True


def reconcile_paper_cursor(
    connection: FillConnection,
    cursor: FillCursor,
    adapter: AlpacaPaperAdapter,
    save_page: Callable[[str, str | None, str, list[FillActivity]], int],
    max_pages: int = 10,
) -> tuple[int, bool]:
    """Ingest fills only when the cursor still belongs to this paper account."""
    if connection["broker"] != "alpaca" or connection["environment"] != "paper":
        raise ValueError("Fill reconciliation requires an Alpaca paper connection")
    if (cursor["connection_id"] != connection["id"]
            or cursor["user_id"] != connection["user_id"]):
        raise ValueError("Fill cursor does not belong to this connection")
    account_number = adapter.account().get("label")
    if (not isinstance(account_number, str) or not account_number.strip()
            or account_number != cursor["account_number"]):
        raise ValueError("Alpaca account does not match the fill cursor")
    return ingest_fill_pages(
        adapter, cursor["cursor"], cursor["starts_at"],
        lambda expected, next_cursor, fills: save_page(cursor["id"], expected, next_cursor, fills),
        max_pages=max_pages,
    )
