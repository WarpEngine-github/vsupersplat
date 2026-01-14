from pathlib import Path

from converter import process_data


def main():
    root = Path(__file__).resolve().parents[1]
    model_root = root / 'assets' / 'model'

    input_file = model_root / 'gs_example' / 'pytorch' / 'gs_example.pkl'
    output_dir = model_root / 'gs_example' / 'converted'
    skeleton_path = model_root / '441_skeleton' / 'pytorch' / '441-skeleton.pt'

    if not input_file.exists():
        raise FileNotFoundError(f"Missing input file: {input_file}")

    output_dir.mkdir(parents=True, exist_ok=True)
    process_data(str(input_file), str(output_dir), str(skeleton_path) if skeleton_path.exists() else None)


if __name__ == "__main__":
    main()
