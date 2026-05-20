# SC-02: Itô's Formula and Product Rule
# Advanced Stochastic Calculus - Deep Dive

**Course Objective:** Master the mechanics and applications of Itô's formula and the stochastic product rule - the fundamental tools for manipulating stochastic differential equations and pricing derivatives.

**Prerequisites:** SC-01 (Continuous Processes & Brownian Motion)

---

## 1. Review and Motivation

### 1.1 The Central Problem

In **SC-01** we established that:
- Brownian motion $W_t$ is continuous but nowhere differentiable
- The naive chain rule fails: $d(W_t^2) \neq 2W_t \, dW_t$
- The key innovation: $(dW_t)^2 = dt$ (sc01.f.4.9)

**The question:** How do we rigorously manipulate functions of stochastic processes?

**The answer:** **Itô's formula** - the stochastic analog of the chain rule, accounting for the quadratic variation of Brownian motion.

### 1.2 Why This Matters for Finance

Itô's formula allows us to:
1. **Transform SDEs** - Convert complex equations into solvable forms
2. **Price derivatives** - Express option values as functions of underlyings
3. **Derive hedging strategies** - Calculate sensitivities (Greeks)
4. **Change numeraires** - Switch between pricing measures

---

## 2. Quadratic Variation: The Foundation

### 2.1 Finite Variation vs. Quadratic Variation

**Definition 2.1 (Variation of a Path):**

For a continuous function $f:[0,T] \to \mathbb{R}$ and partition $\Pi = \{0 = t_0 < t_1 < \cdots < t_n = T\}$, define:

**First variation:**
$$
V_1(f, \Pi) = \sum_{i=1}^n |f(t_i) - f(t_{i-1})|
\tag{sc02.f.2.1}
$$

**Quadratic variation:**
$$
V_2(f, \Pi) = \sum_{i=1}^n (f(t_i) - f(t_{i-1}))^2
\tag{sc02.f.2.2}
$$

### 2.2 Classical Smooth Functions

**Theorem 2.1:** If $f$ is continuously differentiable, then:
- $V_1(f, \Pi) < \infty$ as $|\Pi| \to 0$ (finite first variation)
- $V_2(f, \Pi) \to 0$ as $|\Pi| \to 0$ (zero quadratic variation)

**Proof sketch:** By mean value theorem, $f(t_i) - f(t_{i-1}) = f'(\xi_i)(t_i - t_{i-1})$ for some $\xi_i \in (t_{i-1}, t_i)$. Then:

$$
V_2(f, \Pi) = \sum_{i=1}^n [f'(\xi_i)]^2 (t_i - t_{i-1})^2 \leq M^2 \sum_{i=1}^n (t_i - t_{i-1})^2 \to 0
\tag{sc02.f.2.3}
$$

where $M = \sup |f'|$.

### 2.3 Brownian Motion is Different

**Theorem 2.2 (Quadratic Variation of Brownian Motion):**

For Brownian motion $W_t$ and uniform partition $t_i = iT/n$:

$$
\lim_{n \to \infty} \sum_{i=1}^n (W_{t_i} - W_{t_{i-1}})^2 = T \quad \text{(in probability)}
\tag{sc02.f.2.4}
$$

**Proof:** Let $\Delta W_i = W_{t_i} - W_{t_{i-1}}$. Define:

$$
Z_n = \sum_{i=1}^n (\Delta W_i)^2
\tag{sc02.f.2.5}
$$

**Step 1 - Expectation:**
$$
\mathbb{E}[Z_n] = \sum_{i=1}^n \mathbb{E}[(\Delta W_i)^2] = \sum_{i=1}^n \frac{T}{n} = T
\tag{sc02.f.2.6}
$$

**Step 2 - Variance:** Using $\mathbb{E}[(\Delta W_i)^4] = 3(T/n)^2$ (fourth moment of normal):
$$
\text{Var}(Z_n) = \sum_{i=1}^n \text{Var}((\Delta W_i)^2) = \sum_{i=1}^n \left[3\left(\frac{T}{n}\right)^2 - \left(\frac{T}{n}\right)^2\right] = \frac{2T^2}{n} \to 0
\tag{sc02.f.2.7}
$$

By Chebyshev's inequality, $Z_n \to T$ in probability. ∎

**Consequence:** In differential form, $(dW_t)^2 = dt$ (not zero!).

### 2.4 Multiplication Table for Differentials

From $(dW_t)^2 = dt$, we derive the **Itô multiplication rules:**

| × | $dW_t$ | $dt$ |
|---|--------|------|
| **$dW_t$** | $dt$ | $0$ |
| **$dt$** | $0$ | $0$ |

**sc02.f.2.8**

**Justification:**
- $(dW_t)^2 = dt$ ✓ (proved above)
- $(dW_t)(dt) = O((dt)^{3/2}) \approx 0$ (negligible)
- $(dt)^2 = O((dt)^2) \approx 0$ (negligible)

---

## 3. Itô's Formula: The Complete Story

### 3.1 One-Dimensional Itô's Formula

**Theorem 3.1 (Itô's Formula - Standard Form):**

Let $X_t$ be a stochastic process with SDE:
$$
dX_t = \mu_t \, dt + \sigma_t \, dW_t
\tag{sc02.f.3.1}
$$

If $f(x,t) \in \mathcal{C}^{1,2}$ (once differentiable in $t$, twice in $x$), then $Y_t = f(X_t, t)$ satisfies:

$$
dY_t = \frac{\partial f}{\partial t} dt + \frac{\partial f}{\partial x} dX_t + \frac{1}{2}\frac{\partial^2 f}{\partial x^2} (dX_t)^2
\tag{sc02.f.3.2}
$$

**Expanded form:**
$$
dY_t = \left[\frac{\partial f}{\partial t} + \mu_t \frac{\partial f}{\partial x} + \frac{1}{2}\sigma_t^2 \frac{\partial^2 f}{\partial x^2}\right] dt + \sigma_t \frac{\partial f}{\partial x} dW_t
\tag{sc02.f.3.3}
$$

**Component breakdown:**
- **Volatility:** $\sigma_Y = \sigma_t \frac{\partial f}{\partial x}$ (from stochastic term)
- **Drift:** $\mu_Y = \frac{\partial f}{\partial t} + \mu_t \frac{\partial f}{\partial x} + \frac{1}{2}\sigma_t^2 \frac{\partial^2 f}{\partial x^2}$

The term $\frac{1}{2}\sigma_t^2 \frac{\partial^2 f}{\partial x^2}$ is the **Itô correction** - absent in classical calculus!

### 3.2 Heuristic Derivation

**Taylor expansion** of $f(X_t, t)$ to second order:

$$
\begin{aligned}
df &= \frac{\partial f}{\partial t} dt + \frac{\partial f}{\partial x} dX + \frac{1}{2}\frac{\partial^2 f}{\partial x^2} (dX)^2 + \frac{1}{2}\frac{\partial^2 f}{\partial t^2} (dt)^2 + \frac{\partial^2 f}{\partial x \partial t} (dX)(dt) + \cdots
\end{aligned}
\tag{sc02.f.3.4}
$$

**Apply multiplication rules (sc02.f.2.8):** Substitute $dX_t = \mu_t dt + \sigma_t dW_t$:

$$
(dX_t)^2 = (\mu_t dt + \sigma_t dW_t)^2 = \mu_t^2 (dt)^2 + 2\mu_t \sigma_t (dt)(dW_t) + \sigma_t^2 (dW_t)^2 = \sigma_t^2 dt
\tag{sc02.f.3.5}
$$

Higher order terms $(dt)^2$, $(dX_t)(dt) \sim (dt)^{3/2}$ are negligible. Result: sc02.f.3.3. ✓

### 3.3 Rigorous Statement

**Theorem 3.2 (Itô's Formula - Integral Form):**

Under the conditions of Theorem 3.1, for all $t \geq 0$:

$$
f(X_t, t) = f(X_0, 0) + \int_0^t \frac{\partial f}{\partial s}(X_s, s) ds + \int_0^t \frac{\partial f}{\partial x}(X_s, s) dX_s + \frac{1}{2}\int_0^t \frac{\partial^2 f}{\partial x^2}(X_s, s) \sigma_s^2 ds
\tag{sc02.f.3.6}
$$

where the second integral is a **stochastic Itô integral**.

---

## 4. Worked Examples and Applications

### 4.1 Example 1: Powers of Brownian Motion

**Problem:** Find $d(W_t^n)$ for $n = 3, 4$.

**Solution:** Apply Itô with $f(x) = x^n$, $X_t = W_t$ (so $\mu = 0, \sigma = 1$):

$$
f'(x) = nx^{n-1}, \quad f''(x) = n(n-1)x^{n-2}
\tag{sc02.f.4.1}
$$

**For $n=3$:**
$$
d(W_t^3) = 3W_t^2 \, dW_t + \frac{1}{2} \cdot 6W_t \cdot dt = 3W_t^2 \, dW_t + 3W_t \, dt
\tag{sc02.f.4.2}
$$

**For $n=4$:**
$$
d(W_t^4) = 4W_t^3 \, dW_t + \frac{1}{2} \cdot 12W_t^2 \cdot dt = 4W_t^3 \, dW_t + 6W_t^2 \, dt
\tag{sc02.f.4.3}
$$

**Verification:** $\mathbb{E}[d(W_t^4)] = 6\mathbb{E}[W_t^2] dt = 6t \, dt$ matches $d(\mathbb{E}[W_t^4]) = d(3t^2) = 6t \, dt$. ✓

### 4.2 Example 2: Logarithm of Geometric Brownian Motion

**Problem:** If $S_t$ follows $dS_t = \mu S_t dt + \sigma S_t dW_t$, find $d(\log S_t)$.

**Solution:** Apply Itô with $f(x) = \log x$:

$$
\frac{\partial f}{\partial x} = \frac{1}{x}, \quad \frac{\partial^2 f}{\partial x^2} = -\frac{1}{x^2}
\tag{sc02.f.4.4}
$$

$$
d(\log S_t) = \frac{1}{S_t} dS_t - \frac{1}{2} \cdot \frac{1}{S_t^2} \cdot (\sigma S_t)^2 dt
\tag{sc02.f.4.5}
$$

Substitute $dS_t = \mu S_t dt + \sigma S_t dW_t$:

$$
d(\log S_t) = \frac{1}{S_t}(\mu S_t dt + \sigma S_t dW_t) - \frac{1}{2}\sigma^2 dt = \left(\mu - \frac{1}{2}\sigma^2\right) dt + \sigma dW_t
\tag{sc02.f.4.6}
$$

**Integration:**
$$
\log S_t = \log S_0 + \left(\mu - \frac{1}{2}\sigma^2\right)t + \sigma W_t
\tag{sc02.f.4.7}
$$

Therefore:
$$
S_t = S_0 \exp\left[\left(\mu - \frac{1}{2}\sigma^2\right)t + \sigma W_t\right]
\tag{sc02.f.4.8}
$$

This is the **Black-Scholes stock price model**! The $-\frac{1}{2}\sigma^2$ term is the **Itô correction**.

### 4.3 Example 3: Time-Dependent Function

**Problem:** For Brownian motion $W_t$, compute $d(t W_t)$.

**Solution:** Use $f(x,t) = tx$ with $X_t = W_t$:

$$
\frac{\partial f}{\partial t} = x = W_t, \quad \frac{\partial f}{\partial x} = t, \quad \frac{\partial^2 f}{\partial x^2} = 0
\tag{sc02.f.4.9}
$$

$$
d(t W_t) = W_t \, dt + t \, dW_t + 0 = W_t \, dt + t \, dW_t
\tag{sc02.f.4.10}
$$

**Integral form:**
$$
t W_t = \int_0^t W_s \, ds + \int_0^t s \, dW_s
\tag{sc02.f.4.11}
$$

This gives us a relationship between the stochastic integral $\int_0^t s \, dW_s$ and the ordinary integral.

### 4.4 Example 4: Bessel Process

**Problem:** For $R_t = \sqrt{W_t^2 + t}$, find $dR_t$ (relevant for interest rate models).

**Solution:** Let $f(x,t) = \sqrt{x^2 + t}$:

$$
\frac{\partial f}{\partial t} = \frac{1}{2\sqrt{x^2+t}}, \quad \frac{\partial f}{\partial x} = \frac{x}{\sqrt{x^2+t}}, \quad \frac{\partial^2 f}{\partial x^2} = \frac{t}{(x^2+t)^{3/2}}
\tag{sc02.f.4.12}
$$

For $X_t = W_t$ (so $\mu = 0, \sigma = 1$):

$$
dR_t = \frac{1}{2\sqrt{W_t^2+t}} dt + \frac{W_t}{\sqrt{W_t^2+t}} dW_t + \frac{1}{2} \cdot \frac{t}{(W_t^2+t)^{3/2}} dt
\tag{sc02.f.4.13}
$$

Simplify:
$$
dR_t = \frac{1}{2R_t} dt + \frac{W_t}{R_t} dW_t
\tag{sc02.f.4.14}
$$

---

## 5. The Stochastic Product Rule

### 5.1 Integration by Parts

**Theorem 5.1 (Itô's Product Rule):**

If $X_t$ and $Y_t$ are Itô processes adapted to the same Brownian motion:
$$
\begin{aligned}
dX_t &= \mu_X dt + \sigma_X dW_t \\
dY_t &= \mu_Y dt + \sigma_Y dW_t
\end{aligned}
\tag{sc02.f.5.1}
$$

Then:
$$
d(X_t Y_t) = X_t \, dY_t + Y_t \, dX_t + dX_t \, dY_t
\tag{sc02.f.5.2}
$$

where:
$$
dX_t \, dY_t = \sigma_X \sigma_Y \, dt
\tag{sc02.f.5.3}
$$

**Expanded form:**
$$
d(X_t Y_t) = X_t \, dY_t + Y_t \, dX_t + \sigma_X \sigma_Y \, dt
\tag{sc02.f.5.4}
$$

**Derivation:** Apply Itô's formula to $f(x,y) = xy$:

$$
\frac{\partial f}{\partial x} = y, \quad \frac{\partial f}{\partial y} = x, \quad \frac{\partial^2 f}{\partial x^2} = \frac{\partial^2 f}{\partial y^2} = 0, \quad \frac{\partial^2 f}{\partial x \partial y} = 1
\tag{sc02.f.5.5}
$$

The cross-derivative term contributes: $\frac{\partial^2 f}{\partial x \partial y} (dX_t)(dY_t) = 1 \cdot \sigma_X \sigma_Y dt$.

### 5.2 Integration by Parts Formula

**Corollary 5.1:**

$$
X_t Y_t = X_0 Y_0 + \int_0^t X_s \, dY_s + \int_0^t Y_s \, dX_s + \int_0^t \sigma_X(s) \sigma_Y(s) \, ds
\tag{sc02.f.5.6}
$$

Compare with **classical integration by parts:**
$$
X_t Y_t = X_0 Y_0 + \int_0^t X_s \, dY_s + \int_0^t Y_s \, dX_s \quad \text{(missing the correction term!)}
\tag{sc02.f.5.7}
$$

### 5.3 Example: Product with Exponential

**Problem:** Find $d(W_t e^{W_t})$.

**Solution:** Let $X_t = W_t$, $Y_t = e^{W_t}$.

**Step 1:** Find $dY_t$ using sc02.f.4.6 (Example 4.2) with $\mu = 0, \sigma = 1$:
$$
dY_t = d(e^{W_t}) = e^{W_t} \left(dW_t + \frac{1}{2}dt\right)
\tag{sc02.f.5.8}
$$

**Step 2:** Apply product rule:
$$
\begin{aligned}
d(W_t e^{W_t}) &= W_t \, dY_t + e^{W_t} \, dW_t + (dW_t)(dY_t) \\
&= W_t e^{W_t} \left(dW_t + \frac{1}{2}dt\right) + e^{W_t} dW_t + 1 \cdot e^{W_t} \cdot 1 \cdot dt
\end{aligned}
\tag{sc02.f.5.9}
$$

Simplify:
$$
d(W_t e^{W_t}) = e^{W_t}(W_t + 1) dW_t + e^{W_t}\left(\frac{W_t}{2} + 1\right) dt
\tag{sc02.f.5.10}
$$

---

## 6. Multi-Dimensional Itô's Formula

### 6.1 Two-Dimensional Case

**Theorem 6.1 (Itô's Formula - Two Variables):**

Let $X_t, Y_t$ be Itô processes:
$$
\begin{aligned}
dX_t &= \mu_X dt + \sigma_X dW_t^1 \\
dY_t &= \mu_Y dt + \sigma_Y dW_t^2
\end{aligned}
\tag{sc02.f.6.1}
$$

where $W_t^1, W_t^2$ are Brownian motions with correlation $\rho$ (i.e., $dW_t^1 \, dW_t^2 = \rho \, dt$).

For $f(x,y,t) \in \mathcal{C}^{1,2,2}$, define $Z_t = f(X_t, Y_t, t)$. Then:

$$
\begin{aligned}
dZ_t = &\frac{\partial f}{\partial t} dt + \frac{\partial f}{\partial x} dX_t + \frac{\partial f}{\partial y} dY_t \\
&+ \frac{1}{2}\frac{\partial^2 f}{\partial x^2} (dX_t)^2 + \frac{1}{2}\frac{\partial^2 f}{\partial y^2} (dY_t)^2 + \frac{\partial^2 f}{\partial x \partial y} (dX_t)(dY_t)
\end{aligned}
\tag{sc02.f.6.2}
$$

**Expanded:**
$$
\begin{aligned}
dZ_t = &\left[\frac{\partial f}{\partial t} + \mu_X \frac{\partial f}{\partial x} + \mu_Y \frac{\partial f}{\partial y} + \frac{1}{2}\sigma_X^2 \frac{\partial^2 f}{\partial x^2} + \frac{1}{2}\sigma_Y^2 \frac{\partial^2 f}{\partial y^2} + \rho \sigma_X \sigma_Y \frac{\partial^2 f}{\partial x \partial y}\right] dt \\
&+ \sigma_X \frac{\partial f}{\partial x} dW_t^1 + \sigma_Y \frac{\partial f}{\partial y} dW_t^2
\end{aligned}
\tag{sc02.f.6.3}
$$

### 6.2 Example: Ratio of Processes

**Problem:** For geometric Brownian motions $S_t^1, S_t^2$ with:
$$
\begin{aligned}
dS_t^1 &= \mu_1 S_t^1 dt + \sigma_1 S_t^1 dW_t^1 \\
dS_t^2 &= \mu_2 S_t^2 dt + \sigma_2 S_t^2 dW_t^2
\end{aligned}
\tag{sc02.f.6.4}
$$

Find $d(S_t^1 / S_t^2)$ when $dW_t^1 \, dW_t^2 = \rho \, dt$.

**Solution:** Use $f(x,y) = x/y$:

$$
\frac{\partial f}{\partial x} = \frac{1}{y}, \quad \frac{\partial f}{\partial y} = -\frac{x}{y^2}, \quad \frac{\partial^2 f}{\partial x^2} = 0, \quad \frac{\partial^2 f}{\partial y^2} = \frac{2x}{y^3}, \quad \frac{\partial^2 f}{\partial x \partial y} = -\frac{1}{y^2}
\tag{sc02.f.6.5}
$$

After substitution and simplification:

$$
d\left(\frac{S_t^1}{S_t^2}\right) = \frac{S_t^1}{S_t^2} \left[(\mu_1 - \mu_2 + \sigma_2^2 - \rho\sigma_1\sigma_2) dt + \sigma_1 dW_t^1 - \sigma_2 dW_t^2\right]
\tag{sc02.f.6.6}
$$

Note the **correction term** $+\sigma_2^2 - \rho\sigma_1\sigma_2$ in the drift!

---

## 7. Change of Variables and Solving SDEs

### 7.1 General Strategy

To solve SDE $dX_t = a(X_t, t) dt + b(X_t, t) dW_t$:

**Method 1: Inspired Guess**
1. Guess a transformation $Y_t = f(X_t, t)$
2. Apply Itô's formula to find $dY_t$
3. If $dY_t$ is simpler (e.g., linear), solve for $Y_t$
4. Invert to find $X_t$

**Method 2: Integrating Factor**
1. Look for $f$ such that $\frac{\partial f}{\partial x} = \frac{1}{b(x,t)}$
2. Compute $df$ via Itô's formula
3. Separate variables if possible

### 7.2 Example: Ornstein-Uhlenbeck Process

**Problem:** Solve $dX_t = -\lambda X_t dt + \sigma dW_t$ (mean-reverting process).

**Solution:** Try integrating factor $Y_t = e^{\lambda t} X_t$.

**Step 1:** Compute $d(e^{\lambda t})$:
$$
d(e^{\lambda t}) = \lambda e^{\lambda t} dt
\tag{sc02.f.7.1}
$$

**Step 2:** Apply product rule (sc02.f.5.4):
$$
\begin{aligned}
d(e^{\lambda t} X_t) &= e^{\lambda t} dX_t + X_t d(e^{\lambda t}) + 0 \\
&= e^{\lambda t}(-\lambda X_t dt + \sigma dW_t) + X_t \lambda e^{\lambda t} dt \\
&= \sigma e^{\lambda t} dW_t
\end{aligned}
\tag{sc02.f.7.2}
$$

**Step 3:** Integrate:
$$
e^{\lambda t} X_t = X_0 + \sigma \int_0^t e^{\lambda s} dW_s
\tag{sc02.f.7.3}
$$

**Step 4:** Solve for $X_t$:
$$
X_t = e^{-\lambda t} X_0 + \sigma e^{-\lambda t} \int_0^t e^{\lambda s} dW_s
\tag{sc02.f.7.4}
$$

**Properties:**
- $\mathbb{E}[X_t] = e^{-\lambda t} X_0$ (exponential decay to zero)
- $\text{Var}(X_t) = \frac{\sigma^2}{2\lambda}(1 - e^{-2\lambda t}) \to \frac{\sigma^2}{2\lambda}$ as $t \to \infty$ (stationary)

### 7.3 Example: Cox-Ingersoll-Ross (CIR) Model

**Problem:** For $dX_t = \kappa(\theta - X_t) dt + \sigma \sqrt{X_t} dW_t$, find the transformation that linearizes this equation.

**Hint:** Try $Y_t = \sqrt{X_t}$ (square-root transform).

**Solution:** Apply Itô with $f(x) = \sqrt{x}$:

$$
f'(x) = \frac{1}{2\sqrt{x}}, \quad f''(x) = -\frac{1}{4x^{3/2}}
\tag{sc02.f.7.5}
$$

$$
\begin{aligned}
dY_t &= \frac{1}{2\sqrt{X_t}}[\kappa(\theta - X_t) dt + \sigma\sqrt{X_t} dW_t] + \frac{1}{2} \cdot \left(-\frac{1}{4X_t^{3/2}}\right) \cdot \sigma^2 X_t \, dt \\
&= \left[\frac{\kappa(\theta - X_t)}{2\sqrt{X_t}} - \frac{\sigma^2}{8\sqrt{X_t}}\right] dt + \frac{\sigma}{2} dW_t
\end{aligned}
\tag{sc02.f.7.6}
$$

This is still nonlinear, but shows the structure. CIR typically requires numerical methods or special function solutions.

---

## 8. Advanced Topics

### 8.1 Lévy's Characterization of Brownian Motion

**Theorem 8.1 (Lévy's Theorem):**

If $M_t$ is a continuous local martingale with $M_0 = 0$ and $\langle M \rangle_t = t$ (quadratic variation equals $t$), then $M_t$ is a Brownian motion.

**Application:** Can verify that transformed processes are Brownian motions.

**Example:** For $X_t = \int_0^t f(s) dW_s$ where $\int_0^t f^2(s) ds = t$, then $X_t$ is a Brownian motion (time-changed).

### 8.2 Itô's Formula for Semimartingales

**General case:** For $X_t = M_t + A_t$ where $M_t$ is a local martingale and $A_t$ is a finite variation process:

$$
df(X_t) = f'(X_t) dX_t + \frac{1}{2}f''(X_t) d\langle M \rangle_t
\tag{sc02.f.8.1}
$$

The quadratic variation $\langle M \rangle_t$ replaces $(dX_t)^2$ in the general setting.

### 8.3 Tanaka's Formula (Optional)

For $f(x) = |x|$ (not twice differentiable at $x=0$), a generalized Itô formula exists:

$$
|W_t| = \int_0^t \text{sgn}(W_s) dW_s + L_t^0
\tag{sc02.f.8.2}
$$

where $L_t^0$ is the **local time** at zero - measures time spent at the origin.

---

## 9. Summary and Key Formulas

### 9.1 Main Results

| Concept | Formula | Reference |
|---------|---------|-----------|
| Quadratic variation of BM | $\sum (W_{t_i} - W_{t_{i-1}})^2 \to t$ | sc02.f.2.4 |
| Itô multiplication | $(dW_t)^2 = dt$, others $= 0$ | sc02.f.2.8 |
| **Itô's formula (1D)** | $df = \frac{\partial f}{\partial t}dt + \frac{\partial f}{\partial x}dX + \frac{1}{2}\frac{\partial^2 f}{\partial x^2}\sigma^2 dt$ | **sc02.f.3.3** |
| Log of GBM | $d(\log S_t) = (\mu - \frac{1}{2}\sigma^2)dt + \sigma dW_t$ | sc02.f.4.6 |
| **Product rule** | $d(XY) = X dY + Y dX + \sigma_X\sigma_Y dt$ | **sc02.f.5.4** |
| Integration by parts | $XY = X_0Y_0 + \int X dY + \int Y dX + \int \sigma_X\sigma_Y ds$ | sc02.f.5.6 |
| **Itô's formula (2D)** | Includes cross-term $\frac{\partial^2 f}{\partial x \partial y} (dX)(dY)$ | **sc02.f.6.2** |
| OU process solution | $X_t = e^{-\lambda t}X_0 + \sigma e^{-\lambda t}\int_0^t e^{\lambda s}dW_s$ | sc02.f.7.4 |

### 9.2 The Itô Correction

The key insight: **Quadratic variation of stochastic processes contributes to first-order dynamics**.

For classical processes: $(dx)^2 \approx 0$
For stochastic processes: $(dX)^2 = \sigma^2 dt \neq 0$

This is why:
- $d(\log S) = \frac{dS}{S} - \frac{1}{2}\sigma^2 dt$ (not just $\frac{dS}{S}$)
- Product rule has extra term $+\sigma_X \sigma_Y dt$
- Drift changes under nonlinear transformations

---

## 10. Exercises

**Exercise 10.1:** Compute $d(W_t^5)$ and verify $\mathbb{E}[W_t^5] = 0$.

**Exercise 10.2:** For $X_t = \sin(W_t)$, find $dX_t$ and show it satisfies $dX_t = -\frac{1}{2}X_t dt + \sqrt{1-X_t^2} dW_t$.

**Exercise 10.3:** If $S_t$ satisfies $dS_t = r S_t dt + \sigma S_t dW_t$, compute $d(S_t^{-1})$ and $d(S_t^2)$.

**Exercise 10.4:** Solve $dX_t = (\alpha - \beta X_t) dt + \sigma dW_t$ using integrating factor method.

**Exercise 10.5:** For independent Brownian motions $W_t^1, W_t^2$, compute $d(W_t^1 W_t^2)$ and verify it's a martingale.

**Exercise 10.6:** Prove that if $M_t = \int_0^t \sigma_s dW_s$ with $\int_0^t \sigma_s^2 ds < \infty$, then:
$$
d(M_t^2) = 2M_t dM_t + \sigma_t^2 dt
$$

**Exercise 10.7 (Challenge):** For $X_t = e^{W_t - t/2}$ (martingale), compute $d(X_t^2)$ and show that $X_t^2 - t$ is also a martingale.

**Exercise 10.8:** Derive the SDE for $Z_t = X_t / Y_t$ where $X_t, Y_t$ are independent GBMs with parameters $(\mu_1, \sigma_1)$ and $(\mu_2, \sigma_2)$.

---

## References

**Primary Sources:**
- Baxter, M. & Rennie, A. (1996). *Financial Calculus*. Cambridge. Chapter 3.2-3.3 (pp. 51-98).
- Hull, J. (2018). *Options, Futures, and Other Derivatives*. Pearson. Chapter 13 (Wiener Processes and Itô's Lemma).

**Supplementary (Advanced):**
- Karatzas, I. & Shreve, S. (1998). *Brownian Motion and Stochastic Calculus*. Springer. Chapter 3.
- Øksendal, B. (2003). *Stochastic Differential Equations*. Springer. Chapters 4-5.
- Protter, P. (2004). *Stochastic Integration and Differential Equations*. Springer.

**Russian Source:**
- Федер, Е. (2003). *Фракталы*. Chapter 2: Стохастические уравнения. Sections 2.1-2.4.

---

**End of SC-02 Course**

*All formulas numbered with sc02.f.X.Y for easy cross-referencing. Ready for discussion and practice problems.*
