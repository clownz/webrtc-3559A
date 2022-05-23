#include <iostream>
#include <type_traits>
#include <typeinfo>
#include <memory>
using namespace std;
enum class CheckArgType : int8_t {
  kEnd = 0,
  kInt,
  kLong,
  kLongLong,
  kUInt,
  kULong,
  kULongLong,
  kDouble,
  kLongDouble,
  kCharP,
  kStdString,
  kStringView,
  kVoidP,

  // kCheckOp doesn't represent an argument type. Instead, it is sent as the
  // first argument from RTC_CHECK_OP to make FatalLog use the next two
  // arguments to build the special CHECK_OP error message
  // (the "a == b (1 vs. 2)" bit).
  kCheckOp,
};
asd
template <CheckArgType N, typename T>
struct Val {
  static constexpr CheckArgType Type() { return N; }
  T GetVal() const { return val; }
  T val;
};
inline Val<CheckArgType::kInt, int> MakeVal(int x) {
  return {x};
}
asd
int main()
{
	
	asdf
	
	#if __cplusplus >= 201703L
     asfd
	#endif
    return 0;
}