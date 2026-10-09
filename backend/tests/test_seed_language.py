from backend.tests.test_api import PHONE


def test_seed_language_refresh_preserves_real_calls(db, pack):
    with db.connection(write=True) as connection:
        connection.execute("UPDATE conversations SET summary='Legacy demo seed' WHERE id LIKE 'seed:%'")
    db.add_conversation(PHONE, "voice", "Real earlier customer call")
    db.initialize(pack)
    history = db.history(PHONE)
    assert "Legacy demo seed" not in history["history_summary"]
    assert "Interested in upgrading" in history["history_summary"]
    assert "Real earlier customer call" in history["history_summary"]
