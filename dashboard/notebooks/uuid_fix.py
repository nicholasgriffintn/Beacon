import json
import uuid
import pandas as pd

def find_uuids(obj):
    """Recursively find UUID objects in nested data structures"""
    if isinstance(obj, uuid.UUID):
        return True
    if isinstance(obj, dict):
        return any(find_uuids(v) for v in obj.values())
    if isinstance(obj, list):
        return any(find_uuids(v) for v in obj)
    return False

def stringify_uuids(obj):
    """Recursively convert UUID objects to strings in nested data structures"""
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, dict):
        return {k: stringify_uuids(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [stringify_uuids(v) for v in obj]
    return obj

def check_for_uuids(df):
    """Scan a dataframe for columns containing UUID objects"""
    uuid_cols = []
    for col in df.select_dtypes(include=["object"]):
        sample = df[col].dropna().head(10)
        if sample.apply(lambda x: isinstance(x, uuid.UUID)).any():
            uuid_cols.append(col)
            print(f"Column {col!r} contains UUID objects")
    
    # Check for UUIDs in specific nested columns
    for col in ['session_data', 'device_info', 'event_data', 'raw_event']:
        if col in df.columns:
            sample = df[col].dropna().head(10)
            if sample.apply(find_uuids).any():
                print(f"Nested UUIDs found in {col!r}")
    
    return uuid_cols

def convert_uuids_in_dataframe(df):
    """Convert all UUID objects in a dataframe to strings"""
    df_copy = df.copy()
    
    # Fix top-level UUID columns
    for col in df_copy.select_dtypes(include=["object"]):
        if df_copy[col].dropna().apply(lambda x: isinstance(x, uuid.UUID)).any():
            print(f"Converting UUID column {col} to strings")
            df_copy[col] = df_copy[col].astype(str)
    
    # Fix UUIDs nested in complex columns
    for col in ['session_data', 'device_info', 'event_data', 'raw_event']:
        if col in df_copy.columns:
            print(f"Processing nested objects in column {col}")
            df_copy[col] = df_copy[col].apply(
                lambda x: stringify_uuids(x) if pd.notna(x) else x
            )
    
    return df_copy 