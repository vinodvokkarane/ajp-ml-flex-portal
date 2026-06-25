from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (
    ExtraTreesRegressor,
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    RandomForestRegressor,
)
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.multioutput import MultiOutputRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .synthetic import (
    COUPON_FEATURES,
    COUPON_TARGETS,
    INTERFACE_FEATURES,
    INTERFACE_TARGETS,
    PATTERN_FEATURES,
    PATTERN_TARGETS,
    complete_coupon_payload,
    complete_interface_payload,
    complete_pattern_payload,
)


def _categorical_columns(columns: list[str]) -> list[str]:
    return [
        c
        for c in columns
        if c
        in {
            "material_set",
            "ink",
            "substrate",
            "pattern_type",
            "device_type",
            "coupon_zone",
            "coupon_structure",
            "measurement_family",
            "ink_family",
            "test_method",
        }
    ]


def _numeric_columns(columns: list[str]) -> list[str]:
    cats = set(_categorical_columns(columns))
    return [c for c in columns if c not in cats]


def preprocessor(columns: list[str]) -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            ("categorical", OneHotEncoder(handle_unknown="ignore", sparse_output=False), _categorical_columns(columns)),
            ("numeric", StandardScaler(), _numeric_columns(columns)),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def extra_trees_regressor(random_state: int, n_estimators: int = 160) -> ExtraTreesRegressor:
    return ExtraTreesRegressor(
        n_estimators=n_estimators,
        min_samples_leaf=2,
        random_state=random_state,
        n_jobs=-1,
    )


def hist_gradient_regressor(random_state: int, max_iter: int = 240) -> MultiOutputRegressor:
    return MultiOutputRegressor(
        HistGradientBoostingRegressor(
            max_iter=max_iter,
            learning_rate=0.072,
            l2_regularization=0.045,
            max_leaf_nodes=31,
            random_state=random_state,
        )
    )


def train_pattern_models(pattern_df: pd.DataFrame, seed: int = 11) -> dict[str, Any]:
    train_df, holdout_df = train_test_split(
        pattern_df,
        test_size=0.28,
        random_state=seed,
        stratify=pattern_df["defect_class"],
    )
    cal_df, test_df = train_test_split(
        holdout_df,
        test_size=0.50,
        random_state=seed + 1,
        stratify=holdout_df["defect_class"],
    )

    classifier = Pipeline(
        steps=[
            ("prep", preprocessor(PATTERN_FEATURES)),
            (
                "model",
                HistGradientBoostingClassifier(
                    max_iter=260,
                    learning_rate=0.065,
                    l2_regularization=0.04,
                    max_leaf_nodes=31,
                    random_state=seed,
                    class_weight="balanced",
                ),
            ),
        ]
    )
    regressor = Pipeline(
        steps=[
            ("prep", preprocessor(PATTERN_FEATURES)),
            ("model", hist_gradient_regressor(seed + 2, max_iter=260)),
        ]
    )

    X_train = train_df[PATTERN_FEATURES]
    classifier.fit(X_train, train_df["defect_class"])
    regressor.fit(X_train, train_df[PATTERN_TARGETS])

    X_cal = cal_df[PATTERN_FEATURES]
    cal_pred = regressor.predict(X_cal)
    residual_q90 = np.quantile(np.abs(cal_df[PATTERN_TARGETS].to_numpy() - cal_pred), 0.90, axis=0)

    X_test = test_df[PATTERN_FEATURES]
    cls_pred = classifier.predict(X_test)
    reg_pred = regressor.predict(X_test)
    metrics = {
        "defect_accuracy": float(accuracy_score(test_df["defect_class"], cls_pred)),
        "defect_macro_f1": float(f1_score(test_df["defect_class"], cls_pred, average="macro")),
        "trace_mae": {
            target: float(mean_absolute_error(test_df[target], reg_pred[:, i]))
            for i, target in enumerate(PATTERN_TARGETS)
        },
        "trace_r2": {
            target: float(r2_score(test_df[target], reg_pred[:, i]))
            for i, target in enumerate(PATTERN_TARGETS)
        },
        "conformal_q90": {target: float(residual_q90[i]) for i, target in enumerate(PATTERN_TARGETS)},
        "class_distribution": test_df["defect_class"].value_counts().to_dict(),
    }
    return {
        "classifier": classifier,
        "regressor": regressor,
        "metrics": metrics,
        "features": PATTERN_FEATURES,
        "targets": PATTERN_TARGETS,
    }


def train_interface_model(interface_df: pd.DataFrame, seed: int = 23) -> dict[str, Any]:
    train_df, holdout_df = train_test_split(interface_df, test_size=0.28, random_state=seed)
    cal_df, test_df = train_test_split(holdout_df, test_size=0.50, random_state=seed + 1)

    model = Pipeline(
        steps=[
            ("prep", preprocessor(INTERFACE_FEATURES)),
            ("model", hist_gradient_regressor(seed, max_iter=260)),
        ]
    )
    model.fit(train_df[INTERFACE_FEATURES], train_df[INTERFACE_TARGETS])
    cal_pred = model.predict(cal_df[INTERFACE_FEATURES])
    residual_q90 = np.quantile(np.abs(cal_df[INTERFACE_TARGETS].to_numpy() - cal_pred), 0.90, axis=0)
    test_pred = model.predict(test_df[INTERFACE_FEATURES])

    metrics = {
        "interface_mae": {
            target: float(mean_absolute_error(test_df[target], test_pred[:, i]))
            for i, target in enumerate(INTERFACE_TARGETS)
        },
        "interface_r2": {
            target: float(r2_score(test_df[target], test_pred[:, i]))
            for i, target in enumerate(INTERFACE_TARGETS)
        },
        "conformal_q90": {target: float(residual_q90[i]) for i, target in enumerate(INTERFACE_TARGETS)},
        "device_distribution": test_df["device_type"].value_counts().to_dict(),
    }
    return {
        "model": model,
        "metrics": metrics,
        "features": INTERFACE_FEATURES,
        "targets": INTERFACE_TARGETS,
    }


def train_coupon_model(coupon_df: pd.DataFrame, seed: int = 29) -> dict[str, Any]:
    train_df, holdout_df = train_test_split(
        coupon_df,
        test_size=0.28,
        random_state=seed,
        stratify=coupon_df["failure_mode"],
    )
    cal_df, test_df = train_test_split(
        holdout_df,
        test_size=0.50,
        random_state=seed + 1,
        stratify=holdout_df["failure_mode"],
    )
    regressor = Pipeline(
        steps=[
            ("prep", preprocessor(COUPON_FEATURES)),
            ("model", hist_gradient_regressor(seed, max_iter=275)),
        ]
    )
    classifier = Pipeline(
        steps=[
            ("prep", preprocessor(COUPON_FEATURES)),
            (
                "model",
                HistGradientBoostingClassifier(
                    max_iter=275,
                    learning_rate=0.06,
                    l2_regularization=0.05,
                    max_leaf_nodes=31,
                    random_state=seed + 2,
                    class_weight="balanced",
                ),
            ),
        ]
    )
    regressor.fit(train_df[COUPON_FEATURES], train_df[COUPON_TARGETS])
    classifier.fit(train_df[COUPON_FEATURES], train_df["failure_mode"])

    cal_pred = regressor.predict(cal_df[COUPON_FEATURES])
    residual_q90 = np.quantile(np.abs(cal_df[COUPON_TARGETS].to_numpy() - cal_pred), 0.90, axis=0)
    test_pred = regressor.predict(test_df[COUPON_FEATURES])
    mode_pred = classifier.predict(test_df[COUPON_FEATURES])

    metrics = {
        "failure_accuracy": float(accuracy_score(test_df["failure_mode"], mode_pred)),
        "failure_macro_f1": float(f1_score(test_df["failure_mode"], mode_pred, average="macro")),
        "coupon_mae": {
            target: float(mean_absolute_error(test_df[target], test_pred[:, i]))
            for i, target in enumerate(COUPON_TARGETS)
        },
        "coupon_r2": {
            target: float(r2_score(test_df[target], test_pred[:, i]))
            for i, target in enumerate(COUPON_TARGETS)
        },
        "conformal_q90": {target: float(residual_q90[i]) for i, target in enumerate(COUPON_TARGETS)},
        "failure_distribution": test_df["failure_mode"].value_counts().to_dict(),
        "structure_distribution": test_df["coupon_structure"].value_counts().to_dict(),
        "ink_distribution": test_df["ink_family"].value_counts().to_dict(),
    }
    return {
        "regressor": regressor,
        "classifier": classifier,
        "metrics": metrics,
        "features": COUPON_FEATURES,
        "targets": COUPON_TARGETS,
    }


def benchmark_regressors(df: pd.DataFrame, features: list[str], targets: list[str], seed: int = 37, sample_size: int = 18_000) -> dict[str, Any]:
    bench_df = df.sample(min(sample_size, len(df)), random_state=seed)
    train_df, test_df = train_test_split(bench_df, test_size=0.25, random_state=seed)
    candidates: dict[str, Any] = {
        "ExtraTrees": extra_trees_regressor(seed, n_estimators=120),
        "RandomForest": RandomForestRegressor(
            n_estimators=110,
            min_samples_leaf=2,
            random_state=seed + 1,
            n_jobs=-1,
        ),
        "HistGradientBoosting": MultiOutputRegressor(
            HistGradientBoostingRegressor(max_iter=170, learning_rate=0.075, l2_regularization=0.04, random_state=seed + 2)
        ),
    }
    results: dict[str, Any] = {}
    for name, estimator in candidates.items():
        pipe = Pipeline([("prep", preprocessor(features)), ("model", estimator)])
        pipe.fit(train_df[features], train_df[targets])
        pred = pipe.predict(test_df[features])
        results[name] = {
            "mae_mean": float(np.mean([mean_absolute_error(test_df[t], pred[:, i]) for i, t in enumerate(targets)])),
            "r2_mean": float(np.mean([r2_score(test_df[t], pred[:, i]) for i, t in enumerate(targets)])),
        }
    return results


def save_bundle(bundle: dict[str, Any], artifact_dir: Path) -> None:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, artifact_dir / "model_bundle.joblib", compress=3)
    metrics = bundle["metrics"]
    (artifact_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")


def load_bundle(artifact_dir: Path) -> dict[str, Any]:
    return joblib.load(artifact_dir / "model_bundle.joblib")


def _prediction_interval(prediction: dict[str, float], q90: dict[str, float]) -> dict[str, dict[str, float]]:
    intervals: dict[str, dict[str, float]] = {}
    for key, value in prediction.items():
        if key in q90:
            q = q90[key]
            intervals[key] = {"low": float(value - q), "high": float(value + q)}
    return intervals


def predict_pattern(bundle: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    row = complete_pattern_payload(payload)
    X = pd.DataFrame([row], columns=PATTERN_FEATURES)
    reg_values = bundle["pattern"]["regressor"].predict(X)[0]
    prediction = {target: float(reg_values[i]) for i, target in enumerate(PATTERN_TARGETS)}
    classifier = bundle["pattern"]["classifier"]
    class_probs = classifier.predict_proba(X)[0]
    classes = list(classifier.named_steps["model"].classes_)
    probabilities = {classes[i]: float(class_probs[i]) for i in range(len(classes))}
    defect_class = classes[int(np.argmax(class_probs))]
    overspray_ratio = max(0.0, float(row["d_max_um"]) / max(float(row["d_ideal_um"]), 1.0) - 1.0)
    clog_ratio = max(0.0, 1.0 - float(row["d_min_um"]) / max(float(row["d_ideal_um"]), 1.0))
    return {
        "input": row,
        "prediction": prediction,
        "intervals": _prediction_interval(prediction, bundle["pattern"]["metrics"]["conformal_q90"]),
        "defect_class": defect_class,
        "defect_probabilities": probabilities,
        "derived": {
            "overspray_ratio": overspray_ratio,
            "clog_ratio": clog_ratio,
            "line_width_error_pct": float((prediction["line_width_um"] - row["nominal_width_um"]) / row["nominal_width_um"] * 100.0),
            "thickness_error_pct": float((prediction["thickness_um"] - row["nominal_thickness_um"]) / row["nominal_thickness_um"] * 100.0),
        },
    }


def predict_interface(bundle: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    row = complete_interface_payload(payload)
    X = pd.DataFrame([row], columns=INTERFACE_FEATURES)
    values = bundle["interface"]["model"].predict(X)[0]
    prediction = {target: float(values[i]) for i, target in enumerate(INTERFACE_TARGETS)}
    return {
        "input": row,
        "prediction": prediction,
        "intervals": _prediction_interval(prediction, bundle["interface"]["metrics"]["conformal_q90"]),
    }


def predict_coupon(bundle: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    row = complete_coupon_payload(payload)
    X = pd.DataFrame([row], columns=COUPON_FEATURES)
    values = bundle["coupon"]["regressor"].predict(X)[0]
    prediction = {target: float(values[i]) for i, target in enumerate(COUPON_TARGETS)}
    classifier = bundle["coupon"]["classifier"]
    class_probs = classifier.predict_proba(X)[0]
    classes = list(classifier.named_steps["model"].classes_)
    probabilities = {classes[i]: float(class_probs[i]) for i in range(len(classes))}
    failure_mode = classes[int(np.argmax(class_probs))]
    return {
        "input": row,
        "prediction": prediction,
        "intervals": _prediction_interval(prediction, bundle["coupon"]["metrics"]["conformal_q90"]),
        "failure_mode": failure_mode,
        "failure_probabilities": probabilities,
        "derived": {
            "thermal_exposure": float(max(0.0, row["aging_temp_c"] - 25.0) / 475.0 * np.log1p(row["aging_hours"]) / np.log1p(1000.0)),
            "cycling_exposure": float(max(0.0, row["cycle_high_temp_c"] - row["cycle_low_temp_c"]) / 540.0 * np.log1p(row["thermal_cycles"]) / np.log1p(1000.0)),
            "mechanical_exposure": float(row["strain_pct"] / 6.5 * np.log1p(row["strain_cycles"]) / np.log1p(10000.0)),
            "bonding_case": row["coupon_zone"] == "bonding",
        },
    }


def digital_twin_feedback(bundle: dict[str, Any], payload: dict[str, Any], candidates: int = 600, seed: int = 131) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    base = complete_coupon_payload(payload)
    rows = []
    for _ in range(candidates):
        row = dict(base)
        row.update(
            {
                "print_speed_mm_s": float(rng.uniform(7.0, 22.0)),
                "atomizer_voltage_v": float(rng.uniform(30.0, 40.5)),
                "carrier_flow_sccm": float(rng.uniform(20.0, 37.0)),
                "sheath_flow_sccm": float(rng.uniform(46.0, 76.0)),
                "substrate_temp_c": float(rng.uniform(42.0, 88.0)),
                "cure_peak_temp_c": float(rng.uniform(180.0, 505.0)),
                "cure_time_min": float(rng.uniform(20.0, 95.0)),
                "ct_void_fraction_pct": float(rng.uniform(0.5, 10.0)),
                "oxidation_index": float(rng.uniform(0.04, 0.55)),
                "edge_roughness_um": float(rng.uniform(1.4, 14.5)),
                "alignment_error_um": float(rng.uniform(3.0, 45.0)),
                "thickness_um": float(rng.uniform(1.8, 5.6)),
            }
        )
        row["line_width_um"] = float(row["nominal_width_um"] * rng.uniform(0.93, 1.10))
        rows.append(row)

    X = pd.DataFrame(rows, columns=COUPON_FEATURES)
    pred = bundle["coupon"]["regressor"].predict(X)
    cls_prob = bundle["coupon"]["classifier"].predict_proba(X)
    classes = list(bundle["coupon"]["classifier"].named_steps["model"].classes_)
    pass_idx = classes.index("pass") if "pass" in classes else int(np.argmax(cls_prob.mean(axis=0)))

    target_idx = {target: i for i, target in enumerate(COUPON_TARGETS)}
    reliability = pred[:, target_idx["reliability_score"]]
    sheet = pred[:, target_idx["sheet_resistance_drift_pct"]]
    contact = pred[:, target_idx["contact_resistance_drift_pct"]]
    delam = pred[:, target_idx["delamination_area_pct"]]
    voids = pred[:, target_idx["void_fraction_pct"]]
    shear = pred[:, target_idx["post_aging_shear_mpa"]]
    score = reliability + 16.0 * cls_prob[:, pass_idx] - 0.10 * sheet - 0.09 * contact - 0.12 * delam - 0.42 * voids + 0.16 * shear
    top_idx = np.argsort(score)[-5:][::-1]

    baseline = predict_coupon(bundle, payload)
    baseline_pred = baseline["prediction"]
    top = []
    for idx in top_idx:
        row = X.iloc[idx].to_dict()
        p = {target: float(pred[idx, i]) for i, target in enumerate(COUPON_TARGETS)}
        top.append(
            {
                "score": float(score[idx]),
                "settings": {
                    "print_speed_mm_s": row["print_speed_mm_s"],
                    "atomizer_voltage_v": row["atomizer_voltage_v"],
                    "carrier_flow_sccm": row["carrier_flow_sccm"],
                    "sheath_flow_sccm": row["sheath_flow_sccm"],
                    "cure_peak_temp_c": row["cure_peak_temp_c"],
                    "cure_time_min": row["cure_time_min"],
                    "edge_roughness_um": row["edge_roughness_um"],
                    "ct_void_fraction_pct": row["ct_void_fraction_pct"],
                },
                "prediction": p,
                "pass_probability": float(cls_prob[idx, pass_idx]),
                "improvement": {
                    "reliability_score": float(p["reliability_score"] - baseline_pred["reliability_score"]),
                    "resistance_drift_pct": float(baseline_pred["sheet_resistance_drift_pct"] - p["sheet_resistance_drift_pct"]),
                    "delamination_area_pct": float(baseline_pred["delamination_area_pct"] - p["delamination_area_pct"]),
                },
            }
        )

    best = top[0]
    actions = []
    if baseline_pred["void_fraction_pct"] > 7.5:
        actions.append("Tighten alignment and lower CT void fraction before die attach qualification.")
    if baseline_pred["sheet_resistance_drift_pct"] > 35.0 or baseline_pred["contact_resistance_drift_pct"] > 45.0:
        actions.append("Increase cure robustness and reduce edge roughness to stabilize electrical drift.")
    if baseline_pred["crack_probability"] > 0.35:
        actions.append("Reduce strain dose or split bend/cycle exposure with in-situ resistance checks.")
    if baseline_pred["delamination_area_pct"] > 25.0:
        actions.append("Favor the 500C ink/cure window and inspect overlap pads before bonding escalation.")
    if not actions:
        actions.append("Current recipe is inside the modeled reliability window; continue monitoring drift and voiding.")

    return {
        "baseline": baseline,
        "candidates": candidates,
        "top": top,
        "recommended_recipe": best,
        "actions": actions,
    }


def optimize_process(bundle: dict[str, Any], payload: dict[str, Any], candidates: int = 700, seed: int = 97) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    base = complete_pattern_payload(payload)
    rows = []
    for _ in range(candidates):
        row = dict(base)
        row.update(
            {
                "print_speed_mm_s": float(rng.uniform(6.5, 23.0)),
                "atomizer_voltage_v": float(rng.uniform(29.0, 41.5)),
                "carrier_flow_sccm": float(rng.uniform(19.0, 38.0)),
                "sheath_flow_sccm": float(rng.uniform(44.0, 78.0)),
                "substrate_temp_c": float(rng.uniform(32.0, 88.0)),
                "standoff_mm": float(rng.uniform(2.1, 4.6)),
                "humidity_pct": float(rng.uniform(18.0, 55.0)),
                "deposition_rate_ug_s": float(rng.uniform(12.0, 34.0)),
                "camera_noise": float(rng.uniform(0.006, 0.07)),
                "cure_energy_j_cm2": float(rng.uniform(0.9, 2.3)),
            }
        )
        mist_spread = rng.uniform(0.00, 0.18)
        clog = rng.uniform(0.00, 0.15)
        row["d_ideal_um"] = float(row["nominal_width_um"] * 1.12)
        row["d_max_um"] = float(row["d_ideal_um"] * (1.0 + mist_spread))
        row["d_min_um"] = float(row["d_ideal_um"] * (1.0 - clog))
        row["blob_count"] = int(rng.choice([0, 0, 0, 1, 1, 2], p=[0.42, 0.16, 0.12, 0.16, 0.08, 0.06]))
        row["blob_area_ratio"] = float(row["blob_count"] * rng.uniform(0.001, 0.012))
        row["edge_roughness_um"] = float(2.0 + 12.0 * mist_spread + 14.0 * clog + row["blob_area_ratio"] * 22.0)
        row["boundary_angle_deg"] = float(rng.normal(0.0, 2.0) + 8.0 * mist_spread - 5.0 * clog)
        rows.append(row)

    X = pd.DataFrame(rows, columns=PATTERN_FEATURES)
    reg_pred = bundle["pattern"]["regressor"].predict(X)
    cls_prob = bundle["pattern"]["classifier"].predict_proba(X)
    classes = list(bundle["pattern"]["classifier"].named_steps["model"].classes_)
    nominal_idx = classes.index("nominal") if "nominal" in classes else int(np.argmax(cls_prob.mean(axis=0)))
    line_width = reg_pred[:, PATTERN_TARGETS.index("line_width_um")]
    thickness = reg_pred[:, PATTERN_TARGETS.index("thickness_um")]
    quality = reg_pred[:, PATTERN_TARGETS.index("quality_score")]
    width_err = np.abs(line_width - X["nominal_width_um"].to_numpy()) / X["nominal_width_um"].to_numpy()
    thick_err = np.abs(thickness - X["nominal_thickness_um"].to_numpy()) / X["nominal_thickness_um"].to_numpy()
    score = quality - 170.0 * width_err - 125.0 * thick_err + 18.0 * cls_prob[:, nominal_idx]
    top_idx = np.argsort(score)[-5:][::-1]
    top = []
    for idx in top_idx:
        row = X.iloc[idx].to_dict()
        pred = {target: float(reg_pred[idx, i]) for i, target in enumerate(PATTERN_TARGETS)}
        top.append(
            {
                "score": float(score[idx]),
                "settings": {
                    "print_speed_mm_s": row["print_speed_mm_s"],
                    "atomizer_voltage_v": row["atomizer_voltage_v"],
                    "carrier_flow_sccm": row["carrier_flow_sccm"],
                    "sheath_flow_sccm": row["sheath_flow_sccm"],
                    "substrate_temp_c": row["substrate_temp_c"],
                    "deposition_rate_ug_s": row["deposition_rate_ug_s"],
                },
                "prediction": pred,
                "nominal_probability": float(cls_prob[idx, nominal_idx]),
            }
        )
    return {"candidates": candidates, "top": top}
