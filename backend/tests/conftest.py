import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.db import Database
from backend.pack import IndustryPack


@pytest.fixture
def pack():
    return IndustryPack.load("gadgets")


@pytest.fixture
def db(tmp_path, pack):
    database = Database(tmp_path / "test.sqlite3")
    database.initialize(pack)
    return database
