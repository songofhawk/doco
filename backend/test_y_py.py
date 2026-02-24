import y_py as Y

def test():
    doc = Y.YDoc()
    text = doc.get_text('test')
    
    updates = []
    def callback(event):
        u = event.get_update()
        updates.append(u)
        print(f"Callback fired: update size = {len(u)} bytes")
        # Try to see if it's the full state or incremental
        print(f"Content in callback: '{text}'")

    doc.observe_after_transaction(callback)
    
    print("Starting transaction...")
    with doc.begin_transaction() as tr:
        text.insert(tr, 0, "Hello World")
    print("Transaction finished.")
    
    print(f"Total updates collected: {len(updates)}")
    if updates:
        # Check if applying the update to a new doc works
        doc2 = Y.YDoc()
        Y.apply_update(doc2, updates[0])
        print(f"Doc2 content after applying update: '{doc2.get_text('test')}'")

if __name__ == "__main__":
    test()
