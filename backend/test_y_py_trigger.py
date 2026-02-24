import y_py as Y

def test_apply_triggers_observe():
    doc1 = Y.YDoc()
    text1 = doc1.get_text('t')
    with doc1.begin_transaction() as tr:
        text1.insert(tr, 0, "Initial")
    update = Y.encode_state_as_update(doc1)
    
    doc2 = Y.YDoc()
    text2 = doc2.get_text('t')
    
    triggered = []
    def cb(e):
        u = e.get_update()
        triggered.append(u)
        print(f"Callback triggered! Size: {len(u)}")
        
    doc2.observe_after_transaction(cb)
    
    print("Applying update to doc2...")
    Y.apply_update(doc2, update)
    print("Done.")
    
    if triggered:
        print(f"Doc2 text: '{text2}'")
    else:
        print("Callback NOT triggered by apply_update")

if __name__ == "__main__":
    test_apply_triggers_observe()
