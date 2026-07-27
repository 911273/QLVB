// Module trộn đề trắc nghiệm & chấm - khung.
import Placeholder from '../components/Placeholder.jsx';

export default function QuizMixer() {
  return (
    <Placeholder icon="📝" title="Trộn đề & chấm">
      <p>Module tạo/ trộn đề trắc nghiệm và chấm điểm.</p>
      <ul>
        <li>Ngân hàng câu hỏi lưu ở collection <code>quizzes</code>.</li>
        <li>Trộn đề (đảo câu hỏi/đáp án) có thể chạy hoàn toàn ở client.</li>
        <li>Chấm bằng cách nhập đáp án học sinh, đối chiếu barem.</li>
      </ul>
      <p className="muted">Cho mình biết định dạng đề &amp; barem để triển khai đầy đủ.</p>
    </Placeholder>
  );
}
